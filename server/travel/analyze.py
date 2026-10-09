#!/usr/bin/env python
"""Omnissiah travel: post-process an equirectangular panorama and derive the world state from it.

  analyze.py <base.png> <outdir> [--hi hi.png] [--no-polefix]       -> writes pano_2048.jpg, pano_4096.webp, tiny.webp, meta.json
  analyze.py --views <pano.(jpg|png|webp)> <sheet.png>              -> verification contact sheet (re-projected views)

Conventions (shared with core/travel.js and core/world.js): the panorama is equirectangular, u = atan2(x, -z) / 2pi + 0.5, v = asin(y) / pi + 0.5
(row 0 = zenith), so the image centre looks along -Z (the direction of the Omnissiah), +X is at u = 0.75. Directions in meta are in
that frame, y up. Colours in meta are sRGB hex strings computed from LINEAR averages.
"""
import sys, os, json, math
import numpy as np
from PIL import Image
import cv2

SRGB_A = 0.055


def to_linear(a):
    a = np.asarray(a, dtype=np.float32)
    return np.where(a <= 0.04045, a / 12.92, ((a + SRGB_A) / (1 + SRGB_A)) ** 2.4)


def to_srgb(a):
    a = np.clip(np.asarray(a, dtype=np.float32), 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, (1 + SRGB_A) * a ** (1 / 2.4) - SRGB_A)


def hexof(lin):
    s = (to_srgb(lin) * 255 + 0.5).astype(int)
    return "#%02x%02x%02x" % tuple(int(np.clip(v, 0, 255)) for v in s)


def luma(lin):
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ seam metric
def seam_report(img):
    """mean abs difference across the wrap (last col vs first col) against the median adjacent-column difference"""
    a = img.astype(np.float32)
    wrap = float(np.abs(a[:, -1] - a[:, 0]).mean())
    d = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=(0, 2))
    return {"seam_diff": round(wrap, 3), "median_adjacent_diff": round(float(np.median(d)), 3),
            "ratio": round(wrap / max(float(np.median(d)), 1e-6), 3)}


def seam_heal(img, width_px=24):
    """belt and braces: if the wrap is visibly worse than interior columns, cross-fade a narrow strip over the seam"""
    rep = seam_report(img)
    if rep["ratio"] < 1.6:
        return img, rep, False
    a = img.astype(np.float32)
    w = img.shape[1]
    rolled = np.roll(a, w // 2, axis=1)  # seam now in the middle; blend a strip of the original periodic neighbourhood
    c = w // 2
    # linear cross-fade of the two sides toward their common mean over +-width_px
    L = rolled[:, c - width_px:c]
    R = rolled[:, c:c + width_px]
    t = np.linspace(0, 1, 2 * width_px, dtype=np.float32)[None, :, None]
    left_ref = rolled[:, c - width_px - 1:c - width_px]
    right_ref = rolled[:, c + width_px:c + width_px + 1]
    strip = left_ref * (1 - t) + right_ref * t
    mix = np.concatenate([L, R], axis=1)
    k = (1 - np.abs(t * 2 - 1)) * 0.7
    rolled[:, c - width_px:c + width_px] = mix * (1 - k) + strip * k
    out = np.roll(rolled, -w // 2, axis=1)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8), seam_report(out), True


# ------------------------------------------------------------------ poles
def fix_poles(img, lat0=66.0):
    """blend rows above lat0 (and below -lat0) toward a heavily wrap-blurred copy of themselves so nothing pinches at the poles"""
    a = img.astype(np.float32)
    h, w = a.shape[:2]
    out = a.copy()
    lats = (0.5 - (np.arange(h) + 0.5) / h) * 180.0
    for sign in (1, -1):
        rows = np.where(sign * lats > lat0)[0]
        if len(rows) == 0:
            continue
        r0, r1 = rows.min(), rows.max() + 1
        # progressively stronger horizontal blur toward the pole (wrap-aware)
        for r in range(r0, r1):
            lat = abs(lats[r])
            t = smoothstep(lat0, 90.0, lat)
            sigma = 1.0 + t * w * 0.06
            row = a[r:r + 1]
            ext = np.concatenate([row[:, -int(sigma * 4) - 1:], row, row[:, :int(sigma * 4) + 1]], axis=1)
            blur = cv2.GaussianBlur(ext, (0, 0), sigmaX=sigma, sigmaY=0.01)[:, int(sigma * 4) + 1:-(int(sigma * 4) + 1)]
            mean = row.mean(axis=1, keepdims=True)
            mix_blur = t ** 0.8
            mix_mean = smoothstep(0.55, 1.0, t) * 0.85
            v = row * (1 - mix_blur) + blur * mix_blur
            v = v * (1 - mix_mean) + mean * mix_mean
            out[r:r + 1] = v
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


# ------------------------------------------------------------------ geometry helpers
def dir_grid(h, w):
    """unit directions of each pixel centre in the shared frame; shape (h, w, 3)"""
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    lon = (u - 0.5) * 2 * math.pi            # atan2(x, -z)
    lat = (0.5 - v) * math.pi                # asin(y)
    LON, LAT = np.meshgrid(lon, lat)
    x = np.sin(LON) * np.cos(LAT)
    z = -np.cos(LON) * np.cos(LAT)
    y = np.sin(LAT)
    return np.stack([x, y, z], axis=-1).astype(np.float32), LAT.astype(np.float32), LON.astype(np.float32)


def detect_horizon(small):
    """elevation (degrees, + = above the image equator) of the dominant sky/ground boundary near the equator, from a (128,256,3) uint8 image"""
    g = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 1.2)
    h, w = g.shape
    lo, hi = int(h * 0.30), int(h * 0.70)       # +-36 degrees
    dy = np.abs(g[lo + 2:hi + 2] - g[lo - 2:hi - 2])
    prof = np.median(dy, axis=1) + 0.25 * dy.mean(axis=1)
    # vertical position of the strongest boundary, weighted toward the middle
    rows = np.arange(lo, hi)
    wgt = np.exp(-(((rows - h / 2) / (h * 0.14)) ** 2))
    best = rows[int(np.argmax(prof * wgt))]
    return float((h / 2 - (best + 0.5)) / h * 180.0)


def kmeans_colors(px, k=3, iters=12):
    px = px.astype(np.float32)
    if len(px) < k:
        return np.repeat(px.mean(axis=0, keepdims=True), k, axis=0), np.ones(k) / k
    rng = np.random.default_rng(1)
    c = px[rng.choice(len(px), k, replace=False)]
    for _ in range(iters):
        d = ((px[:, None, :] - c[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        for i in range(k):
            m = lab == i
            if m.any():
                c[i] = px[m].mean(0)
    cnt = np.bincount(lab, minlength=k).astype(np.float32)
    return c, cnt / cnt.sum()


# ------------------------------------------------------------------ derive the world state
def derive(img_u8, name=None):
    small = cv2.resize(img_u8, (512, 256), interpolation=cv2.INTER_AREA)
    lin = to_linear(small.astype(np.float32) / 255.0)
    Y = luma(lin)
    dirs, LAT, LON = dir_grid(256, 512)
    elev_deg = np.degrees(LAT)
    area = np.cos(LAT)[..., None]

    hor = detect_horizon(cv2.resize(img_u8, (256, 128), interpolation=cv2.INTER_AREA))
    hor_raw = hor
    # the detector is fooled by canopies, clouds and mountains (checked on the atlas): trust it only a little. The prompts ask for a level horizon on the equator.
    hor = float(np.clip(hor, -3.0, 3.0) * 0.5)
    rel = elev_deg - hor   # elevation above the pano's own horizon

    def band(lo, hi, trim=0.12):
        m = (rel >= lo) & (rel < hi)
        if not m.any():
            return lin.reshape(-1, 3).mean(0)
        # per-column means, then a trimmed mean over columns so a sun glow does not own the colour
        cols = []
        for j in range(lin.shape[1]):
            mm = m[:, j]
            if mm.any():
                cols.append(lin[mm, j].mean(0))
        cols = np.array(cols)
        ly = luma(cols)
        order = np.argsort(ly)
        n = len(order)
        sel = order[int(n * trim): max(int(n * (1 - trim)), int(n * trim) + 1)]
        return cols[sel].mean(0)

    zenith = band(55, 90)
    mid = band(14, 38)
    horizon = band(-1.5, 5.5)
    low = band(-60, -14)

    # sun / brightest region (above the horizon), weighted direction
    up = rel > 1.5
    w = np.where(up, Y, 0.0) ** 6
    w = w * (np.cos(LAT))
    vec = (dirs * w[..., None]).sum((0, 1))
    n = np.linalg.norm(vec)
    sun_dir = (vec / n) if n > 1e-9 else np.array([0.0, 0.3, -1.0])
    yv = Y.copy()
    yv[~up] = 0
    peak = float(np.percentile(yv[up], 99.7)) if up.any() else 0.0
    mean_up = float(Y[up].mean()) if up.any() else 0.0
    j, i = np.unravel_index(np.argmax(cv2.GaussianBlur(yv, (0, 0), 3)), yv.shape)
    sun_peak_dir = dirs[j, i]
    # a visible sun/moon: a compact bright blob well above the average sky
    blob = cv2.GaussianBlur(yv, (0, 0), 3)
    sun_visible = bool(blob.max() > 0.62 and blob.max() > 2.2 * mean_up)
    if sun_visible:
        sun_dir = sun_peak_dir.astype(np.float64)
    hot = (blob > blob.max() * 0.8) & up
    sun_col = lin[hot].mean(0) if hot.any() else horizon
    sun_col = sun_col / max(float(sun_col.max()), 1e-4)  # chroma only; strength is separate
    sun_strength = float(np.clip(peak * 1.15, 0.0, 1.0))
    sun_dir = sun_dir / (np.linalg.norm(sun_dir) + 1e-9)
    sun_el = math.degrees(math.asin(float(np.clip(sun_dir[1], -1, 1))))
    sun_az = math.degrees(math.atan2(float(sun_dir[0]), -float(sun_dir[2])))  # 0 = -Z, +90 = +X

    # ground palette from the lower hemisphere
    m = (rel < -12) & (rel > -70)
    gpx = lin[m]
    gc, gw = kmeans_colors(gpx[:: max(1, len(gpx) // 6000)], 4)
    # the two most common colours are the ground (a = darker, b = lighter); rare bright clusters (lava, sparks, flowers) are not the ground
    top = np.argsort(-gw)
    two = gc[top[:2]]
    two = two[np.argsort(luma(two))]
    rest = gc[top[2:]]
    gc = np.concatenate([two[:1], rest[:1] if len(rest) else two[:1], two[1:]], axis=0)  # a, mid, b
    ground_mean = np.median(gpx, axis=0)
    sea_band = band(-16, -3)

    # haze: how washed-out is the distant band, contrast of luminance just above the horizon
    mm = (rel > 1.0) & (rel < 12)
    contrast = float(Y[mm].std() / (Y[mm].mean() + 1e-4)) if mm.any() else 0.5
    fog_density = float(np.clip(0.0042 + 0.0075 * (1.0 - np.clip(contrast / 0.8, 0, 1)), 0.0038, 0.014))

    zl = float(luma(zenith))
    stars = float(np.clip((0.05 - zl) / 0.045, 0, 1))
    meanY = float(Y.mean())

    # saturation / warmth hints
    def sat(c):
        mx, mn = float(c.max()), float(c.min())
        return (mx - mn) / (mx + 1e-4)

    return {
        "horizon_deg": round(hor, 2), "horizon_raw": round(hor_raw, 2),
        "sky": {"zenith": hexof(zenith), "mid": hexof(mid), "horizon": hexof(horizon)},
        "fog": {"color": hexof(horizon), "density": round(fog_density, 5)},
        "sun": {"dir": [round(float(v), 4) for v in sun_dir], "elevation": round(sun_el, 1), "azimuth": round(sun_az, 1),
                "color": hexof(np.clip(sun_col, 0, 1)), "strength": round(sun_strength, 3), "visible": sun_visible},
        "ground": {"a": hexof(gc[0]), "b": hexof(gc[-1]), "mid": hexof(gc[1]), "mean": hexof(ground_mean),
                   "far": hexof(0.5 * horizon + 0.5 * ground_mean), "lum": round(float(luma(ground_mean)), 4)},
        "sea": hexof(sea_band),
        "stars": round(stars, 2),
        "mean_luma": round(meanY, 4), "zenith_luma": round(zl, 4), "horizon_luma": round(float(luma(horizon)), 4),
        "contrast": round(contrast, 3), "sat_zenith": round(sat(zenith), 3), "sat_horizon": round(sat(horizon), 3),
    }


# ------------------------------------------------------------------ re-projection (verification)
def reproject(pano_u8, yaw_deg, pitch_deg, fov_deg=90, size=(640, 480)):
    W, H = size
    f = 0.5 * W / math.tan(math.radians(fov_deg) / 2)
    xs = (np.arange(W) + 0.5 - W / 2) / f
    ys = -(np.arange(H) + 0.5 - H / 2) / f
    X, Y = np.meshgrid(xs, ys)
    d = np.stack([X, Y, -np.ones_like(X)], axis=-1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    p = math.radians(pitch_deg)
    cp, sp = math.cos(p), math.sin(p)
    y2 = d[..., 1] * cp - d[..., 2] * sp
    z2 = d[..., 1] * sp + d[..., 2] * cp
    d = np.stack([d[..., 0], y2, z2], axis=-1)
    yw = math.radians(yaw_deg)
    cy, sy = math.cos(yw), math.sin(yw)
    x3 = d[..., 0] * cy + d[..., 2] * sy
    z3 = -d[..., 0] * sy + d[..., 2] * cy
    d = np.stack([x3, d[..., 1], z3], axis=-1)
    lon = np.arctan2(d[..., 0], -d[..., 2])
    lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    ph, pw = pano_u8.shape[:2]
    mapx = ((lon / (2 * math.pi) + 0.5) * pw - 0.5).astype(np.float32)
    mapy = ((0.5 - lat / math.pi) * ph - 0.5).astype(np.float32)
    return cv2.remap(pano_u8, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def views_sheet(path, out, hor_off=0.0):
    img = np.asarray(Image.open(path).convert("RGB"))
    cells = []
    # pitch is offset by the detected horizon so "eye level" really looks at the horizon
    for label, yaw, pitch in [("front", 0, 0), ("right", 90, 0), ("back", 180, 0), ("left", 270, 0), ("seam", 180, 0), ("up", 0, 80), ("down", 0, -80)]:
        v = reproject(img, yaw, pitch, 90, (480, 360))
        if label == "seam":
            v = reproject(np.roll(img, img.shape[1] // 2, axis=1), 180, 0, 90, (480, 360))  # seam centred (should look continuous)
            v = reproject(img, 180, 0, 90, (480, 360))
        cv2.putText(v, label, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cells.append(v)
    blank = np.zeros_like(cells[0])
    rows = [np.concatenate(cells[0:4], axis=1), np.concatenate(cells[4:7] + [blank], axis=1)]
    Image.fromarray(np.concatenate(rows, axis=0)).save(out)


# ------------------------------------------------------------------ driver
def process(base_path, outdir, hi_path=None, polefix=True):
    os.makedirs(outdir, exist_ok=True)
    img = np.asarray(Image.open(base_path).convert("RGB"))
    img, seam, healed = seam_heal(img)
    if polefix:
        img = fix_poles(img)
    seam_after = seam_report(img)
    meta = derive(img)
    meta["seam"] = {"before": seam, "after": seam_after, "healed": healed}
    h, w = img.shape[:2]
    lo = Image.fromarray(img).resize((2048, 1024), Image.LANCZOS) if w != 2048 else Image.fromarray(img)
    lo.save(os.path.join(outdir, "pano_2048.jpg"), quality=90, optimize=True, subsampling=0)
    if hi_path and os.path.exists(hi_path):
        hi = np.asarray(Image.open(hi_path).convert("RGB"))
        hi, _, _ = seam_heal(hi, 48)
        if polefix:
            hi = fix_poles(hi)
        hi = Image.fromarray(hi)
    else:
        hi = Image.fromarray(img).resize((4096, 2048), Image.LANCZOS)
        a = np.asarray(hi).astype(np.float32)
        bl = cv2.GaussianBlur(a, (0, 0), 1.4)
        hi = Image.fromarray(np.clip(a + 0.5 * (a - bl), 0, 255).astype(np.uint8))  # mild unsharp: the 2x is a plain upscale
    hi.save(os.path.join(outdir, "pano_4096.webp"), quality=88, method=5)
    tiny = cv2.resize(cv2.GaussianBlur(img, (0, 0), 14), (64, 32), interpolation=cv2.INTER_AREA)
    Image.fromarray(tiny).save(os.path.join(outdir, "tiny.webp"), quality=80)
    meta["files"] = {"lo": "pano_2048.jpg", "hi": "pano_4096.webp", "tiny": "tiny.webp"}
    meta["bytes"] = {k: os.path.getsize(os.path.join(outdir, v)) for k, v in meta["files"].items()}
    with open(os.path.join(outdir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    return meta


def redo(places_dir):
    """re-derive meta.json of every place from its saved 2048 panorama (after the derivation was improved); files are not touched"""
    for slug in sorted(os.listdir(places_dir)):
        d = os.path.join(places_dir, slug)
        pj, mj = os.path.join(d, "pano_2048.jpg"), os.path.join(d, "meta.json")
        if not (os.path.isfile(pj) and os.path.isfile(mj)):
            continue
        old = json.load(open(mj))
        new = derive(np.asarray(Image.open(pj).convert("RGB")))
        for k in ("seam", "files", "bytes"):
            if k in old:
                new[k] = old[k]
        json.dump(new, open(mj, "w"), indent=1)
        print("redone", slug)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "--views":
        views_sheet(a[1], a[2])
    elif a and a[0] == "--redo":
        redo(a[1])
    else:
        hi = a[a.index("--hi") + 1] if "--hi" in a else None
        m = process(a[0], a[1], hi, polefix="--no-polefix" not in a)
        print(json.dumps(m))

