#!/usr/bin/env python
"""Image -> game-ready GLB runner (Microsoft TRELLIS.2) for the Omnissiah gen3d worker.

Runs in the existing trellis2 micromamba env (python 3.10). JSON lines on stdin/stdout:
  -> {"cmd":"run","id":"..","image":"/in.png","seed":1,"quality":"standard","out":"/out.glb"}
  <- {"event":"ready",...} | {"event":"stage","id":..,"state":"sculpting|exporting","message":..}
     | {"event":"result","id":..,"ok":true,"glb":..,"stats":{...}} | {"event":"result","ok":false,"error":..}
  -> {"cmd":"quit"}
"""
import os, sys, io, json, time, traceback

_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def emit(obj):
    _proto.write(json.dumps(obj) + "\n")
    _proto.flush()


os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("ATTN_BACKEND", "xformers")  # flash_attn is not installed
sys.path.insert(0, "/opt/trellis/TRELLIS.2")

# xformers' newest attention kernel ("flash3") aborts with CUDA "invalid argument" on RTX 50-series
# cards; its previous flash kernel works, so force that one (same patch as the first working run).
import xformers.ops as xops
from xformers.ops import fmha

_attention = xops.memory_efficient_attention


def _attention_without_flash3(query, key, value, attn_bias=None, p=0.0, scale=None, *, op=None, output_dtype=None):
    op = op or (fmha.flash.FwOp, fmha.flash.BwOp)
    return _attention(query, key, value, attn_bias=attn_bias, p=p, scale=scale, op=op, output_dtype=output_dtype)


xops.memory_efficient_attention = _attention_without_flash3

# quality -> (target triangles, texture px, TRELLIS pipeline type)
PRESETS = {
    "low": dict(faces=6000, tex=512, ptype="512"),
    "standard": dict(faces=20000, tex=1024, ptype="512"),
    "high": dict(faces=60000, tex=2048, ptype="1024_cascade"),
}


def finish_mesh(tm, tex_px, jpeg_q):
    """Normalise a trimesh from to_glb: Y up, centred X/Z, base at y=0, longest side = 1,
    +Z front; compact material: JPEG base colour, constant metallic/roughness."""
    import numpy as np
    from PIL import Image
    import trimesh

    v = np.asarray(tm.vertices, dtype=np.float64)
    lo, hi = v.min(0), v.max(0)
    ext = (hi - lo).max()
    centre = (lo + hi) / 2
    v[:, 0] -= centre[0]
    v[:, 2] -= centre[2]
    v[:, 1] -= lo[1]
    v /= ext
    tm.vertices = v

    mat = tm.visual.material
    base = mat.baseColorTexture
    mr = mat.metallicRoughnessTexture
    uv = np.asarray(tm.visual.uv)
    # Average metallic/roughness only over texels that are actually used by the mesh
    metallic_f, rough_f = 0.0, 0.85
    if mr is not None:
        a = np.asarray(mr.convert("RGB"), dtype=np.float32) / 255.0
        px = np.zeros((len(uv), 2), dtype=int)
        px[:, 0] = np.clip(uv[:, 0] * (a.shape[1] - 1), 0, a.shape[1] - 1).astype(int)
        px[:, 1] = np.clip((1 - uv[:, 1]) * (a.shape[0] - 1), 0, a.shape[0] - 1).astype(int)
        s = a[px[:, 1], px[:, 0]]
        rough_f = float(np.clip(s[:, 1].mean(), 0.35, 1.0))
        metallic_f = float(np.clip(s[:, 2].mean(), 0.0, 0.6))
    rgb = base.convert("RGB")
    if rgb.size[0] != tex_px:
        rgb = rgb.resize((tex_px, tex_px), Image.LANCZOS)
    buf = io.BytesIO()
    rgb.save(buf, "JPEG", quality=jpeg_q, optimize=True, subsampling=0)
    buf.seek(0)
    jpg = Image.open(buf)
    jpg.load()
    tm.visual.material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=jpg,
        baseColorFactor=[255, 255, 255, 255],
        metallicFactor=metallic_f,
        roughnessFactor=rough_f,
        alphaMode="OPAQUE",
        doubleSided=False,
    )
    return tm, dict(metallic=round(metallic_f, 2), roughness=round(rough_f, 2))


def rss_gb():
    """Resident + swapped memory of this process in GB."""
    try:
        with open("/proc/self/status") as fh:
            return round(sum(int(ln.split()[1]) for ln in fh if ln.startswith(("VmRSS", "VmSwap"))) / 2**20, 2)
    except Exception:
        return None


def trim_memory():
    """Hand freed heap pages back to the OS (the process shares a 20 GB WSL VM with the text-to-image runner)."""
    import gc, ctypes
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def main():
    t0 = time.time()
    import numpy as np
    import torch
    from PIL import Image
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    from bake import bake_mesh

    # RAM is the scarce resource here: WSL is capped at 20 GB and the pipeline keeps its weights on the CPU
    # between stages (low_vram mode). All 8 flow/decoder models are 16 GB; the 512 path only needs 11 GB, so
    # only the models of the pipeline type in use stay loaded (the other set is swapped in on demand, ~10 s).
    NEED = {
        "512": ["sparse_structure_decoder", "sparse_structure_flow_model", "shape_slat_decoder", "tex_slat_decoder",
                "shape_slat_flow_model_512", "tex_slat_flow_model_512"],
        "1024": ["sparse_structure_decoder", "sparse_structure_flow_model", "shape_slat_decoder", "tex_slat_decoder",
                 "shape_slat_flow_model_1024", "tex_slat_flow_model_1024"],
        "1024_cascade": ["sparse_structure_decoder", "sparse_structure_flow_model", "shape_slat_decoder",
                         "tex_slat_decoder", "shape_slat_flow_model_512", "shape_slat_flow_model_1024",
                         "tex_slat_flow_model_1024"],
    }
    NEED["1536_cascade"] = NEED["1024_cascade"]
    Trellis2ImageTo3DPipeline.model_names_to_load = NEED["512"]
    pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
    pipeline.cuda()
    torch.cuda.synchronize()

    def ensure_models(ptype):
        import gc
        from trellis2 import models as t2models
        need = set(NEED[ptype])
        for k in [k for k in pipeline.models if k not in need]:
            del pipeline.models[k]
        gc.collect()
        for k in need:
            if k not in pipeline.models:
                v = pipeline._pretrained_args["models"][k]
                try:
                    m = t2models.from_pretrained(f"microsoft/TRELLIS.2-4B/{v}")
                except Exception:
                    m = t2models.from_pretrained(v)
                m.eval()
                pipeline.models[k] = m
                print(f"[trellis_runner] loaded {k}", file=sys.stderr, flush=True)

    # per-stage timing of the TRELLIS pipeline (reported in the job stats)
    prof = {}

    def timed(name):
        orig = getattr(pipeline, name)

        def wrapper(*a, **k):
            torch.cuda.synchronize()
            t = time.time()
            r = orig(*a, **k)
            torch.cuda.synchronize()
            prof[name] = round(prof.get(name, 0.0) + time.time() - t, 2)
            return r
        setattr(pipeline, name, wrapper)

    for n in ("preprocess_image", "get_cond", "sample_sparse_structure", "sample_shape_slat_cascade",
              "sample_shape_slat", "sample_tex_slat", "decode_latent"):
        timed(n)
    trim_memory()
    emit({"event": "ready", "load_seconds": round(time.time() - t0, 1), "rss_gb": rss_gb(),
          "vram_gb": round(torch.cuda.memory_allocated() / 2**30, 2)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        if req.get("cmd") == "quit":
            break
        if req.get("cmd") != "run":
            continue
        rid = req.get("id")
        try:
            preset = PRESETS.get(req.get("quality"), PRESETS["standard"])
            faces = int(req.get("faces") or preset["faces"])
            tex = int(req.get("tex") or preset["tex"])
            ptype = req.get("ptype") or preset["ptype"]
            remesh = req.get("remesh", True)
            seed = int(req.get("seed") or 0)
            torch.cuda.reset_peak_memory_stats()
            prof.clear()
            stats = {}
            ensure_models(ptype)

            emit({"event": "stage", "id": rid, "state": "sculpting", "message": "Sculpting the form"})
            t1 = time.time()
            img = Image.open(req["image"])
            cut = pipeline.preprocess_image(img)
            if req.get("cutout"):
                cut.save(req["cutout"])
            with torch.no_grad():
                mesh = pipeline.run(cut, seed=seed, preprocess_image=False, pipeline_type=ptype)[0]
            mesh.simplify(int(req.get("prebake_faces") or 4000000))  # also bounds VRAM of the bake (stock example: 16.7M)
            stats["sculpt_seconds"] = round(time.time() - t1, 2)
            stats["profile"] = dict(prof)
            stats["raw_vertices"] = int(mesh.vertices.shape[0])
            stats["raw_faces"] = int(mesh.faces.shape[0])
            stats["sculpt_peak_gb"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)

            emit({"event": "stage", "id": rid, "state": "exporting", "message": "Baking a game-ready model"})
            t2 = time.time()
            torch.cuda.reset_peak_memory_stats()
            tm, bake_info = bake_mesh(
                mesh.vertices, mesh.faces, mesh.attrs, mesh.coords, mesh.layout,
                aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], voxel_size=mesh.voxel_size,
                decimation_target=faces, texture_size=tex, remesh=bool(remesh),
                debug=req.get("debug_prefix"),
            )
            stats["bake"] = bake_info
            stats["bake_seconds"] = round(time.time() - t2, 2)
            stats["export_peak_gb"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)
            t3 = time.time()
            tm, mat = finish_mesh(tm, tex, int(req.get("jpeg_quality") or 88))
            data = tm.export(file_type="glb")
            with open(req["out"], "wb") as f:
                f.write(data)
            stats["finish_seconds"] = round(time.time() - t3, 2)
            stats.update(material=mat, triangles=int(len(tm.faces)), vertices=int(len(tm.vertices)),
                         texture=tex, bytes=len(data),
                         bounds=[[round(float(x), 4) for x in b] for b in tm.bounds])
            del mesh, tm
            torch.cuda.empty_cache()
            trim_memory()
            stats["rss_gb"] = rss_gb()
            emit({"event": "result", "id": rid, "ok": True, "glb": req["out"], "stats": stats})
        except Exception as e:
            traceback.print_exc()
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
            emit({"event": "result", "id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        emit({"event": "fatal", "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
