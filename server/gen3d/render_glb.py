#!/usr/bin/env python
"""Render a turntable contact sheet of one or more GLBs (verification tool; trellis2 env, nvdiffrast).

    python render_glb.py out.png model1.glb [model2.glb ...]   # 4 views per model, one row per model
"""
import os, sys, math
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
import numpy as np
import torch
import trimesh
import nvdiffrast.torch as dr
from PIL import Image

RES = 384


def look_at(eye, target, up=(0, 1, 0)):
    eye, target, up = map(lambda a: np.asarray(a, dtype=np.float64), (eye, target, up))
    f = target - eye; f /= np.linalg.norm(f)
    s = np.cross(f, up); s /= np.linalg.norm(s)
    u = np.cross(s, f)
    m = np.eye(4)
    m[0, :3], m[1, :3], m[2, :3] = s, u, -f
    m[:3, 3] = -m[:3, :3] @ eye
    return m


def persp(fov_deg, aspect, n=0.05, f=20.0):
    t = 1.0 / math.tan(math.radians(fov_deg) / 2)
    return np.array([[t / aspect, 0, 0, 0], [0, t, 0, 0],
                     [0, 0, -(f + n) / (f - n), -2 * f * n / (f - n)], [0, 0, -1, 0]], dtype=np.float64)


def load(path):
    sc = trimesh.load(path, force="scene")
    geoms = list(sc.geometry.values())
    m = geoms[0]
    tex = np.asarray(m.visual.material.baseColorTexture.convert("RGB"), dtype=np.float32) / 255.0
    return m, tex


def render(ctx, m, tex, az, el=18.0, dist=2.7):
    dev = "cuda"
    v = torch.tensor(np.asarray(m.vertices), dtype=torch.float32, device=dev)
    n = torch.tensor(np.asarray(m.vertex_normals), dtype=torch.float32, device=dev)
    uv = torch.tensor(np.asarray(m.visual.uv), dtype=torch.float32, device=dev)
    uv = torch.stack([uv[:, 0], 1.0 - uv[:, 1]], 1)  # trimesh keeps v-up; image rows run top-down
    tri = torch.tensor(np.asarray(m.faces), dtype=torch.int32, device=dev)
    t = torch.tensor(tex, device=dev)[None]
    a, e = math.radians(az), math.radians(el)
    eye = (0 + dist * math.cos(e) * math.sin(a), 0.5 + dist * math.sin(e), dist * math.cos(e) * math.cos(a))
    mv = look_at(eye, (0, 0.5, 0))
    mvp = torch.tensor(persp(35, 1.0) @ mv, dtype=torch.float32, device=dev)
    vh = torch.cat([v, torch.ones_like(v[:, :1])], 1)
    clip = (vh @ mvp.T)[None]
    rast, _ = dr.rasterize(ctx, clip, tri, resolution=[RES, RES])
    uvi, uvd = dr.interpolate(uv[None], rast, tri)
    nrm, _ = dr.interpolate(n[None], rast, tri)
    nrm = torch.nn.functional.normalize(nrm, dim=-1)
    col = dr.texture(t, uvi, filter_mode="linear")
    # key light from the camera's upper left, plus sky/ground ambient
    L = torch.tensor(np.asarray([-0.4, 0.8, 0.5]) / np.linalg.norm([-0.4, 0.8, 0.5]), dtype=torch.float32, device=dev)
    Lw = torch.tensor(np.linalg.inv(mv[:3, :3]) @ np.asarray(L.cpu()), dtype=torch.float32, device=dev)
    diff = (nrm * Lw).sum(-1, keepdim=True).clamp(min=0)
    amb = 0.55 + 0.25 * nrm[..., 1:2]
    lit = col * (amb + 0.55 * diff)
    mask = (rast[..., 3:4] > 0).float()
    bg = torch.tensor([0.80, 0.84, 0.90], device=dev).view(1, 1, 1, 3)
    out = (lit.clamp(0, 1) * mask + bg * (1 - mask))[0]
    return (out.flip(0).cpu().numpy() * 255).astype(np.uint8)  # nvdiffrast origin is bottom-left


def main():
    out, paths = sys.argv[1], sys.argv[2:]
    ctx = dr.RasterizeCudaContext()
    sheet = Image.new("RGB", (RES * 4, RES * len(paths)))
    for r, p in enumerate(paths):
        m, tex = load(p)
        for c, az in enumerate((30, 120, 210, 300)):
            sheet.paste(Image.fromarray(render(ctx, m, tex, az)), (c * RES, r * RES))
    sheet.save(out)
    print("saved", out)


if __name__ == "__main__":
    main()
