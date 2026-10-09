"""In-process UniRig (VAST-AI-Research/UniRig, MIT code; checkpoints from HF `VAST-AI/UniRig`, MIT) without Blender.

The stock scripts shell out to Blender (`bpy`) for mesh loading and FBX export. Here the same datasets / transforms /
models are driven directly from numpy, so a job costs seconds instead of a process start + model load:

    eng = Engine()
    sk  = eng.skeleton(verts_yup, faces, seed=1)         # joints/tails/parents/names in the mesh's own (Y-up) frame
    skin = eng.skin(verts_yup, faces, sk)                # (N, J) weights for every input vertex
    eng.unload()

Runs only inside the rig env (`~/rig/env`, python 3.11, torch 2.7.1+cu128). Coordinates: UniRig was trained on Blender
data (Z-up, character faces -Y); glTF is Y-up with the front toward +Z, so (x, y, z) -> (x, -z, y) going in and the
inverse coming out.
"""
import os, sys, time, gc, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
UNIRIG = os.environ.get("UNIRIG_DIR", os.path.expanduser("~/rig/UniRig"))
sys.path.insert(0, os.path.join(HERE, "shim"))  # flash_attn stand-in
sys.path.insert(0, UNIRIG)

import numpy as np


def to_blender(v):
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[..., 0], -v[..., 2], v[..., 1]], -1)


def from_blender(v):
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def _to_dev(x, dev):
    import torch
    if isinstance(x, torch.Tensor):
        return x.to(dev)
    if isinstance(x, dict):
        return {k: _to_dev(v, dev) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return type(x)(_to_dev(v, dev) for v in x)
    return x


def _voxelization(vertices, faces, grid=256, scale=1.0, backend="pyrender"):
    """numpy replacement for UniRig's pyrender/open3d voxelisation (no OpenGL / open3d needed).
    vertices are already in [-1, 1]; returns the centres of the filled voxels of a grid^3 lattice."""
    import trimesh
    m = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    voxel = 2.0 / grid
    n = int(min(1_500_000, max(200_000, m.area / (voxel * voxel) * 6)))
    pts, _ = trimesh.sample.sample_surface(m, n, seed=0)
    pts = np.concatenate([pts, vertices], 0)
    idx = np.clip(np.floor((pts + 1.0) / voxel).astype(np.int64), 0, grid - 1)
    occ = np.zeros((grid, grid, grid), dtype=bool)
    occ[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    # same "inside" rule as UniRig's open3d branch: filled if enclosed along at least two axes
    INF = np.iinfo(np.int32).max
    g = np.indices(occ.shape)

    def span(axis):
        c = g[axis]
        lo = np.where(occ, c, INF).min(axis=axis, keepdims=True)
        hi = np.where(occ, c, -1).max(axis=axis, keepdims=True)
        return (c >= lo) & (c <= hi)

    fill = (span(0).astype(np.int8) + span(1) + span(2)) >= 2
    occ |= fill
    ijk = np.argwhere(occ)
    return -1.0 + (ijk + 0.5) * voxel


class Engine:
    def __init__(self, device="cuda", log=print):
        self.dev = device
        self.log = log
        self.ar = None
        self.sk = None
        self.work = tempfile.mkdtemp(prefix="unirig_", dir=os.environ.get("RIG_TMP", "/tmp"))
        self._cwd = os.getcwd()

    # ------------------------------------------------------------------ loading
    def _yaml(self, rel):
        import yaml
        from box import Box
        with open(os.path.join(UNIRIG, rel + ("" if rel.endswith(".yaml") else ".yaml"))) as f:
            return Box(yaml.safe_load(f))

    def _build(self, task_rel, ckpt_key, patch_attn=False):
        import torch
        os.chdir(UNIRIG)  # configs reference ./configs/... relative paths
        torch.set_float32_matmul_precision("high")
        from src.data.dataset import UniRigDataset
        from src.data.transform import TransformConfig
        from src.tokenizer.spec import TokenizerConfig
        from src.tokenizer.parse import get_tokenizer
        from src.model.parse import get_model
        from src.system.parse import get_system
        from src.inference.download import download
        import src.data.vertex_group as vgroup
        vgroup.voxelization = _voxelization

        task = self._yaml(task_rel)
        tcfg = self._yaml(os.path.join("configs/transform", task.components.transform))
        transform = TransformConfig.parse(config=tcfg.get("predict_transform_config"))
        tokenizer = None
        if task.components.get("tokenizer"):
            tok_cfg = TokenizerConfig.parse(config=self._yaml(os.path.join("configs/tokenizer", task.components.tokenizer)))
            tokenizer = get_tokenizer(config=tok_cfg)
        mcfg = self._yaml(os.path.join("configs/model", task.components.model))
        if patch_attn:  # no flash-attn wheel for Blackwell: let transformers use torch SDPA
            mcfg["llm"]["_attn_implementation"] = "sdpa"
        model = get_model(tokenizer=tokenizer, **mcfg)
        scfg = self._yaml(os.path.join("configs/system", task.components.system))
        system = get_system(**scfg, model=model, optimizer_config=None, loss_config=None, scheduler_config=None, steps_per_epoch=1)
        path = download(task.resume_from_checkpoint)
        ck = torch.load(path, map_location="cpu", weights_only=False)
        missing = system.load_state_dict(ck["state_dict"], strict=False)
        if missing.missing_keys or missing.unexpected_keys:
            self.log(f"[unirig] state_dict: missing={missing.missing_keys[:5]} unexpected={missing.unexpected_keys[:5]}")
        del ck
        system.eval().to(self.dev)
        return dict(task=task, transform=transform, tokenizer=tokenizer, model=model, system=system, ds_cls=UniRigDataset, ckpt=path)

    def load_skeleton(self):
        if self.ar is None:
            t = time.time()
            self.ar = self._build("configs/task/quick_inference_skeleton_articulationxl_ar_256", "ar", patch_attn=True)
            self.log(f"[unirig] skeleton model loaded in {time.time() - t:.1f}s")
        return self.ar

    def load_skin(self):
        if self.sk is None:
            t = time.time()
            self.sk = self._build("configs/task/quick_inference_unirig_skin", "skin")
            self.log(f"[unirig] skin model loaded in {time.time() - t:.1f}s")
        return self.sk

    def unload(self):
        import torch
        self.ar = self.sk = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        try:
            import ctypes
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except Exception:
            pass

    def close(self):
        self.unload()
        shutil.rmtree(self.work, ignore_errors=True)

    # ------------------------------------------------------------------ data
    def _write_raw(self, d, verts_b, faces):
        import trimesh
        from src.data.raw_data import RawData
        m = trimesh.Trimesh(vertices=np.asarray(verts_b, dtype=np.float32), faces=np.asarray(faces, dtype=np.int64), process=False)
        raw = RawData(vertices=np.asarray(m.vertices, np.float32), vertex_normals=np.asarray(m.vertex_normals, np.float32),
                      faces=np.asarray(m.faces, np.int64), face_normals=np.asarray(m.face_normals, np.float32),
                      joints=None, skin=None, parents=None, names=None, matrix_local=None, tails=None, no_skin=None)
        os.makedirs(d, exist_ok=True)
        raw.save(os.path.join(d, "raw_data.npz"))
        return m

    def _batch(self, b, d, data_name):
        ds = b["ds_cls"](data=[("inference", d)], name="predict", process_fn=b["model"]._process_fn, tokenizer=b["tokenizer"],
                         transform_config=b["transform"], debug=False, data_name=data_name)
        batch = ds.collate_fn([ds[0]])
        return _to_dev(batch, self.dev)

    # ------------------------------------------------------------------ skeleton
    def skeleton(self, verts_yup, faces, seed=1, cls="articulationxl", num_beams=None, temperature=None):
        """Predict a skeleton. Returns dict(joints (J,3) Y-up, tails, parents list[int|None], names, cls)."""
        import torch
        import lightning as L
        b = self.load_skeleton()
        L.seed_everything(int(seed), workers=True)
        d = os.path.join(self.work, "mesh")
        shutil.rmtree(d, ignore_errors=True)
        vb = to_blender(verts_yup)
        self._write_raw(d, vb, faces)
        batch = self._batch(b, d, "raw_data.npz")
        gk = dict(b["system"].generate_kwargs)
        if num_beams:
            gk["num_beams"] = int(num_beams)
        if temperature:
            gk["temperature"] = float(temperature)
        gk["assign_cls"] = cls
        b["system"].generate_kwargs = gk
        batch["generate_kwargs"] = gk
        t = time.time()
        with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
            out = b["system"].model.predict_step(batch)
        det = out[0]
        # undo UniRig's normalisation into [-1, 1] (uniform scale about the bbox centre)
        lo, hi = vb.min(0), vb.max(0)
        centre, scale = (lo + hi) / 2, float(np.max(hi - lo) / 2)
        j = np.asarray(det.joints, np.float64) * scale + centre
        tl = np.asarray(det.tails, np.float64) * scale + centre if det.tails is not None else None
        res = dict(joints=from_blender(j), tails=None if tl is None else from_blender(tl),
                   parents=[None if p is None else int(p) for p in det.parents], names=list(det.names) if det.names else [f"bone_{i}" for i in range(len(j))],
                   cls=det.cls, seconds=round(time.time() - t, 2), norm=dict(centre=centre.tolist(), scale=scale))
        # keep a copy for the skin stage (it reads `predict_skeleton.npz` in normalised space)
        from src.data.raw_data import RawData
        origin_v = batch["origin_vertices"][0, : int(batch["num_points"][0])].float().cpu().numpy()
        raw = RawData(vertices=origin_v, vertex_normals=batch["origin_vertex_normals"][0, : int(batch["num_points"][0])].float().cpu().numpy(),
                      faces=batch["origin_faces"][0, : int(batch["num_faces"][0])].cpu().numpy(),
                      face_normals=batch["origin_face_normals"][0, : int(batch["num_faces"][0])].float().cpu().numpy(),
                      joints=det.joints, tails=det.tails, parents=det.parents, skin=None, no_skin=det.no_skin, names=det.names,
                      matrix_local=None, path=None, cls=det.cls)
        raw.save(os.path.join(d, "predict_skeleton.npz"))
        # sanity: our normalisation matches the model's
        chk = np.abs(origin_v - (vb - centre) / scale).max()
        res["norm_error"] = float(chk)
        return res

    # ------------------------------------------------------------------ skin
    def skin(self, verts_yup, faces, skel=None):
        """Skinning weights (N, J) for the vertices handed to skeleton() last (same order)."""
        import torch
        from src.system.skin import reskin
        b = self.load_skin()
        d = os.path.join(self.work, "mesh")
        batch = self._batch(b, d, "predict_skeleton.npz")
        t = time.time()
        with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
            res = b["system"].predict_step(batch, 0)
        pred = res["skin_pred"][0]
        samp = res.get("sampled_vertices", None)
        sampled_vertices = (samp if samp is not None else batch["vertices"])
        sampled_vertices = sampled_vertices.float().detach().cpu().numpy()[0]
        pred = pred.float().detach().cpu().numpy()
        N = int(batch["num_points"][0]); J = int(batch["num_bones"][0]); F = int(batch["num_faces"][0])
        o_vertices = batch["origin_vertices"][0, :N].float().cpu().numpy()
        parents = [None if int(p) < 0 else int(p) for p in batch["parents"][0, :J].cpu().numpy()]
        sk = reskin(sampled_vertices=sampled_vertices, vertices=o_vertices, parents=parents,
                    faces=batch["origin_faces"][0, :F].cpu().numpy(), sampled_skin=pred, sample_method="median", alpha=2.0, threshold=0.03)
        return dict(weights=np.asarray(sk, np.float32), seconds=round(time.time() - t, 2))
