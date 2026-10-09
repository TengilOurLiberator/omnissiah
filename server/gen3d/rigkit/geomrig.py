"""Geometric rigger: a skeleton + skin weights from the mesh alone (no neural network). Used when UniRig's skeleton does not agree with what the
geometry shows (e.g. the number of feet touching the ground), and as the "always works" fallback for legged creatures.

Method: horizontal PCA gives the body axis; the head end is the end with the higher / bigger mass; feet = clusters of the lowest vertices (per side
of the mirror plane, 1-D k-means along the body axis); each leg gets hip-knee-ankle-toe above its foot; one spine chain (hips -> shoulders -> neck -> head),
a tail chain; skin weights from the distance to the bone segments (gaussian falloff, kept to the 4 strongest, then smoothed by the pipeline).
Mediocre by design, never fails. Output frame = the input frame (the analysis re-aligns it)."""
import numpy as np
from scipy.cluster.vq import kmeans2
from scipy.cluster.hierarchy import fcluster, linkage


def foot_clusters(verts, size=None, low_frac=0.1):
    """number of separate ground contacts (clusters of the lowest vertices), plus their xz centres"""
    H = verts[:, 1].max() - verts[:, 1].min()
    size = size or float(np.ptp(verts, axis=0).max())
    low = verts[verts[:, 1] < verts[:, 1].min() + low_frac * H][:, [0, 2]]
    if len(low) < 20:
        return 0, np.zeros((0, 2))
    if len(low) > 2500:
        low = low[np.random.default_rng(0).choice(len(low), 2500, replace=False)]
    Z = linkage(low, "single")
    lab = fcluster(Z, 0.02 * size, "distance")
    cents = []
    for k in np.unique(lab):
        pts = low[lab == k]
        if len(pts) >= max(4, 0.02 * len(low)):
            cents.append(pts.mean(0))
    return len(cents), np.array(cents)


def _yaw_rot(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def geometric_rig(verts, faces, n_legs=None, log=print):
    verts = np.asarray(verts, np.float64)
    size = float(np.ptp(verts, axis=0).max())
    # --- orientation: long horizontal axis -> +Z
    xz = verts[:, [0, 2]] - verts[:, [0, 2]].mean(0)
    ev, vec = np.linalg.eigh(np.cov(xz.T))
    ax = vec[:, 1]                                    # principal direction (x, z) of the footprint
    n_c, cents = foot_clusters(verts, size)
    if n_c >= 4:                                      # the feet form a rectangle along the body: more reliable than a fluffy / curved silhouette
        ev2, vec2 = np.linalg.eigh(np.cov((cents - cents.mean(0)).T))
        if ev2[1] > 1.3 * ev2[0]:
            ax = vec2[:, 1]
    yaw = np.arctan2(ax[0], ax[1])                    # rotate so it lies along +Z: R_y(yaw) maps (sin, cos) onto (0, 1)... solved numerically below
    R = _yaw_rot(-yaw)
    p = verts @ R.T
    if np.ptp(p[:, 2]) < np.ptp(p[:, 0]):             # safety: make Z the longer one
        R = _yaw_rot(-yaw + np.pi / 2)
        p = verts @ R.T
    lo, hi = p.min(0), p.max(0)
    H = float(hi[1] - lo[1])
    L = float(hi[2] - lo[2])
    x0 = float((lo[0] + hi[0]) / 2)
    # head end: the end region that reaches higher
    z_lo, z_hi = lo[2], hi[2]
    end_lo = p[p[:, 2] < z_lo + 0.22 * L]
    end_hi = p[p[:, 2] > z_hi - 0.22 * L]
    if end_lo[:, 1].max() > end_hi[:, 1].max() + 0.02 * H:
        R = _yaw_rot(np.pi) @ R
        p = verts @ R.T
        lo, hi = p.min(0), p.max(0)
    x0 = float((lo[0] + hi[0]) / 2)
    z_lo, z_hi = float(lo[2]), float(hi[2])
    # --- feet
    ground = p[p[:, 1] < lo[1] + 0.1 * H]
    per_side = None if n_legs is None else max(1, int(round(n_legs / 2)))
    legs = []
    sides = []
    for sgn in (1, -1):
        pts = ground[(ground[:, 0] - x0) * sgn > 0.02 * size]
        sides.append(pts)
    if per_side is None:
        n_c, _ = foot_clusters(p)
        per_side = int(np.clip(round(n_c / 2), 1, 4))
    for sgn, pts in zip((1, -1), sides):
        if len(pts) < 8:
            continue
        k = min(per_side, max(1, len(pts) // 8))
        init = np.quantile(pts[:, 2], np.linspace(0.15, 0.85, k)) if k > 1 else np.array([pts[:, 2].mean()])
        cent, lab = kmeans2(pts[:, [2]], init[:, None], minit="matrix")
        for c in range(len(cent)):
            m = lab == c
            if m.sum() < 4:
                continue
            legs.append((sgn, float(np.abs(pts[m, 0] - x0).mean()), float(pts[m, 2].mean())))
    if not legs:
        raise ValueError("no feet found")
    # mirror the two sides: same x offset / z for matching rows
    legs.sort(key=lambda t: (-t[0], t[2]))
    byside = {1: [l for l in legs if l[0] == 1], -1: [l for l in legs if l[0] == -1]}
    m = min(len(byside[1]), len(byside[-1]))
    legs = []
    for r in range(m):
        a, b = byside[1][r], byside[-1][r]
        xo, z = (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
        legs.append((1, xo, z)); legs.append((-1, xo, z))
    if not legs:
        legs = [(s, l[1], l[2]) for s in (1, -1) for l in byside[s][:1]]
    zs = sorted({round(l[2], 4) for l in legs})
    z_rear, z_front = zs[0], zs[-1]
    y_belly = float(np.clip(0.6 * H, 0.35 * H, 0.75 * H))
    names, parents, joints = [], [], []

    def add(name, parent, pos):
        names.append(name); parents.append(parent); joints.append(pos)
        return len(joints) - 1

    # spine: hips (rear legs) ... shoulders (front legs) ... neck ... head
    hips = add("hips", None, np.array([x0, y_belly, z_rear]))
    nspine = 3
    prev = hips
    spine = [hips]
    for i in range(1, nspine + 1):
        z = z_rear + (z_front - z_rear) * i / nspine
        prev = add(f"spine{i}", prev, np.array([x0, y_belly + 0.02 * H * i, z]))
        spine.append(prev)
    shoulders = spine[-1]
    neck1 = add("neck1", shoulders, np.array([x0, min(y_belly + 0.1 * H, 0.9 * H), z_front + 0.12 * L]))
    head = add("head", neck1, np.array([x0, min(y_belly + 0.16 * H, 0.93 * H), min(z_hi - 0.12 * L, z_front + 0.28 * L)]))
    add("head_tip", head, np.array([x0, min(y_belly + 0.12 * H, 0.9 * H), z_hi - 0.03 * L]))
    # tail
    t_prev = hips
    for i in range(1, 4):
        t_prev = add(f"tail{i}", t_prev, np.array([x0, y_belly - 0.04 * H * i, z_rear - (z_rear - z_lo) * i / 3.2]))
    # legs
    zfoot_rows = sorted(zs)
    for (sgn, xo, z) in legs:
        anchor = hips if abs(z - z_rear) < abs(z - z_front) else shoulders
        zc = z_rear if anchor == hips else z_front
        x = x0 + sgn * xo
        hip = add(f"hip{sgn}_{z:.2f}", anchor, np.array([x0 + sgn * 0.8 * xo, y_belly - 0.04 * H, zc]))
        ypos = lo[1] + np.array([0.52, 0.28, 0.1]) * H
        knee = add("knee", hip, np.array([x, ypos[0], z - 0.02 * L]))
        ank = add("ankle", knee, np.array([x, ypos[1], z]))
        add("toe", ank, np.array([x, lo[1] + 0.03 * H, z + 0.05 * L]))
    J = len(joints)
    joints = np.array(joints)
    par = [-1 if q is None else q for q in parents]
    ch = [[] for _ in range(J)]
    for j, q in enumerate(par):
        if q >= 0:
            ch[q].append(j)
    # --- skin weights: gaussian falloff of the distance to each bone segment (joint -> first child; a leaf uses its parent's segment end)
    P = p
    D = np.zeros((len(P), J))
    for j in range(J):
        if ch[j]:
            a, b = joints[j], joints[ch[j][0]]
            D[:, j] = _seg_dist(P, a, b)
        else:
            a = joints[par[j]]
            D[:, j] = np.linalg.norm(P - joints[j], axis=1) * 1.0
        # legs are thin, the trunk is fat
    sig = np.full(J, 0.07 * size)
    for j, nm in enumerate(names):
        if nm in ("hips",) or nm.startswith("spine"):
            sig[j] = 0.16 * size
        elif nm.startswith("head") or nm.startswith("neck"):
            sig[j] = 0.1 * size
        elif nm.startswith("tail"):
            sig[j] = 0.06 * size
        else:
            sig[j] = 0.055 * size
    Wt = np.exp(-(D / sig[None]) ** 2 * 1.6)
    # the nearest bone always keeps some weight
    near = D.argmin(1)
    Wt[np.arange(len(P)), near] += 1e-3
    # keep the 4 strongest, normalise
    idx = np.argsort(-Wt, axis=1)[:, 4:]
    np.put_along_axis(Wt, idx, 0.0, axis=1)
    Wt /= Wt.sum(1, keepdims=True)
    # back to the input frame
    joints_in = joints @ R
    log(f"[geomrig] {J} bones, {len(legs)} legs")
    return dict(names=names, parents=parents, joints=joints_in), Wt
