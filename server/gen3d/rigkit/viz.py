"""Tiny numpy/PIL software renderer for rig verification: shaded mesh (optionally coloured by skin weights) with the
skeleton overlaid, from several views, plus helpers to build contact sheets. No GPU, no GL."""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PALETTE = np.array([
    [230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230],
    [210, 245, 60], [250, 190, 212], [0, 128, 128], [220, 190, 255], [170, 110, 40], [255, 250, 200], [128, 0, 0], [170, 255, 195],
    [128, 128, 0], [255, 215, 180], [0, 0, 128], [128, 128, 128]], dtype=np.float64)


def look_at(eye, target, up=(0, 1, 0)):
    eye, target, up = (np.asarray(a, np.float64) for a in (eye, target, up))
    f = target - eye
    f /= np.linalg.norm(f)
    s = np.cross(f, up)
    s /= np.linalg.norm(s)
    u = np.cross(s, f)
    R = np.stack([s, u, -f])
    return R, -R @ eye


class Cam:
    def __init__(self, az=30, el=15, centre=(0, 0.4, 0), radius=0.9, size=384, fov=32):
        a, e = math.radians(az), math.radians(el)
        d = radius / math.tan(math.radians(fov) / 2) * 1.05
        self.eye = np.asarray(centre) + d * np.array([math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a)])
        self.R, self.t = look_at(self.eye, centre)
        self.f = 1 / math.tan(math.radians(fov) / 2)
        self.size = size

    def project(self, p):
        c = p @ self.R.T + self.t
        z = -c[..., 2]
        x = c[..., 0] / z * self.f
        y = c[..., 1] / z * self.f
        S = self.size
        return np.stack([(x * 0.5 + 0.5) * S, (0.5 - y * 0.5) * S, z], -1)


def raster(cam, verts, faces, colors, light=(0.4, 0.8, 0.5), ambient=0.45):
    """Flat-shaded z-buffer rasteriser. colors: (F,3) 0..255 or (N,3) per-vertex. Returns (S,S,3) uint8."""
    S = cam.size
    P = cam.project(verts)
    tri = P[faces]                                   # F,3,3
    n = np.cross(verts[faces[:, 1]] - verts[faces[:, 0]], verts[faces[:, 2]] - verts[faces[:, 0]])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    L = np.asarray(light, np.float64)
    L /= np.linalg.norm(L)
    Lc = L @ cam.R.T * 0 + L  # light fixed in world space
    shade = ambient + (1 - ambient) * np.clip(n @ Lc, 0, 1)
    cf = colors if colors.shape[0] == faces.shape[0] else colors[faces].mean(1)
    col = cf * shade[:, None]
    img = np.zeros((S, S, 3), np.float64)
    img[:] = (225, 232, 240)
    zb = np.full((S, S), np.inf)
    order = np.argsort(-tri[:, :, 2].mean(1))      # painter order is enough with the z test below
    for fi in order:
        t = tri[fi]
        x0, y0 = t[:, 0].min(), t[:, 1].min()
        x1, y1 = t[:, 0].max(), t[:, 1].max()
        ix0, iy0 = max(int(x0), 0), max(int(y0), 0)
        ix1, iy1 = min(int(x1) + 1, S - 1), min(int(y1) + 1, S - 1)
        if ix1 < ix0 or iy1 < iy0:
            continue
        xs, ys = np.meshgrid(np.arange(ix0, ix1 + 1) + 0.5, np.arange(iy0, iy1 + 1) + 0.5)
        d = (t[1, 1] - t[2, 1]) * (t[0, 0] - t[2, 0]) + (t[2, 0] - t[1, 0]) * (t[0, 1] - t[2, 1])
        if abs(d) < 1e-9:
            continue
        w0 = ((t[1, 1] - t[2, 1]) * (xs - t[2, 0]) + (t[2, 0] - t[1, 0]) * (ys - t[2, 1])) / d
        w1 = ((t[2, 1] - t[0, 1]) * (xs - t[2, 0]) + (t[0, 0] - t[2, 0]) * (ys - t[2, 1])) / d
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not m.any():
            continue
        z = w0 * t[0, 2] + w1 * t[1, 2] + w2 * t[2, 2]
        sub = zb[iy0:iy1 + 1, ix0:ix1 + 1]
        upd = m & (z < sub)
        sub[upd] = z[upd]
        img[iy0:iy1 + 1, ix0:ix1 + 1][upd] = col[fi]
    return img


def vertex_weight_colors(weights, n_joints=None):
    """Blend palette colours by skin weight (N,J) -> (N,3)."""
    J = weights.shape[1]
    pal = PALETTE[np.arange(J) % len(PALETTE)]
    return weights @ pal


def draw_skeleton(img, cam, heads, parents, names=None, marks=None, width=3, label=False):
    """img: (S,S,3) uint8/float array -> PIL image with bones drawn on top (always visible)."""
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    dr = ImageDraw.Draw(im)
    P = cam.project(np.asarray(heads))
    marks = marks or {}
    for j, p in enumerate(parents):
        if p is None or p < 0:
            continue
        col = marks.get(j, (20, 20, 20))
        dr.line([tuple(P[p][:2]), tuple(P[j][:2])], fill=(255, 255, 255), width=width + 2)
        dr.line([tuple(P[p][:2]), tuple(P[j][:2])], fill=col, width=width)
    for j in range(len(heads)):
        x, y = P[j][:2]
        r = 4 if j else 6
        dr.ellipse([x - r, y - r, x + r, y + r], fill=marks.get(j, (255, 60, 40)), outline=(0, 0, 0))
        if label and names is not None:
            dr.text((x + 5, y - 5), str(j), fill=(0, 0, 0))
    return im


def sheet(images, cols, pad=2, bg=(255, 255, 255), captions=None):
    if not images:
        return None
    w, h = images[0].size
    rows = math.ceil(len(images) / cols)
    out = Image.new("RGB", (cols * w + (cols + 1) * pad, rows * h + (rows + 1) * pad), bg)
    dr = ImageDraw.Draw(out)
    for i, im in enumerate(images):
        x, y = pad + (i % cols) * (w + pad), pad + (i // cols) * (h + pad)
        out.paste(im, (x, y))
        if captions and i < len(captions) and captions[i]:
            dr.text((x + 4, y + 3), captions[i], fill=(0, 0, 0))
    return out


def rig_overlay(verts, faces, heads, parents, weights=None, views=((30, 15), (120, 15), (210, 15), (0, 90)), size=384, colour=(170, 175, 190), marks=None, label=False):
    """One image per view: mesh (grey or skin-weight coloured) + skeleton."""
    lo, hi = verts.min(0), verts.max(0)
    centre = (lo + hi) / 2
    radius = float(np.linalg.norm(hi - lo)) / 2
    vcol = vertex_weight_colors(weights) if weights is not None else np.tile(np.asarray(colour, np.float64), (len(verts), 1))
    out = []
    for az, el in views:
        cam = Cam(az, el, centre, radius, size)
        img = raster(cam, verts, faces, vcol)
        out.append(draw_skeleton(img, cam, heads, parents, marks=marks, label=label))
    return out
