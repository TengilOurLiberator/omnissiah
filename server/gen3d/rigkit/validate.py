"""Numeric validation of a rigged GLB, re-read from disk (independent of the code that wrote it).

Checks: weights (sum to 1, <= 4 influences, finite, every vertex bound), bone count, bones inside the mesh bounds, bind pose reproduces the
rest mesh, loop continuity (first == last pose), joint angular speed (no flips), the mesh never sinks below the ground or explodes during a clip,
and foot sliding of the walk / run clips (stance feet must stand still on the ground while the body moves at the clip's stated speed)."""
import numpy as np
from . import lbs, mathx as mx

LOOPS = ("idle", "walk", "run", "fly", "hover", "wave", "cheer", "dance", "wind")


def check(path, meta=None, fps=30, log=print):
    r = lbs.RiggedGLB(path)
    rep = {"ok": True, "problems": [], "numbers": {}}

    def bad(msg):
        rep["ok"] = False
        rep["problems"].append(msg)

    n = rep["numbers"]
    jw, ji = r.jw, r.jidx
    n["bones"] = r.J
    n["vertices"] = int(len(r.verts))
    n["weights_sum_err"] = float(np.abs(jw.sum(1) - 1).max())
    n["max_influences"] = int((jw > 1e-6).sum(1).max())
    n["nan"] = bool(~np.isfinite(r.verts).all() or ~np.isfinite(jw).all())
    if n["weights_sum_err"] > 1e-4: bad(f"weights do not sum to 1 (err {n['weights_sum_err']:.2e})")
    if n["max_influences"] > 4: bad("more than 4 influences")
    if n["nan"]: bad("NaN in vertices / weights")
    if ji.max() >= r.J: bad("joint index out of range")
    if r.J > 40: bad(f"{r.J} bones (budget 40)")
    # every vertex bound to a bone that has a nonzero weight, none to the ground root only
    n["unbound"] = int((jw.sum(1) < 0.999).sum())
    if n["unbound"]: bad(f"{n['unbound']} vertices unbound")
    lo, hi = r.verts.min(0), r.verts.max(0)
    n["bounds"] = [[round(float(x), 4) for x in lo], [round(float(x), 4) for x in hi]]
    if abs(lo[1]) > 0.02: bad(f"base not at y=0 (min y {lo[1]:.3f})")
    # bind pose
    v0, jt0 = r.skinned(None, 0.0)
    n["bind_pose_err"] = float(np.abs(v0 - r.verts).max())
    if n["bind_pose_err"] > 1e-5: bad(f"bind pose does not reproduce the mesh ({n['bind_pose_err']:.2e})")
    pad = 0.04 * (hi - lo).max()
    outside = [j for j in range(1, r.J) if np.any(jt0[j] < lo - pad) or np.any(jt0[j] > hi + pad)]
    n["bones_outside_bounds"] = len(outside)
    if outside: bad(f"{len(outside)} bones outside the mesh bounds")
    n["size"] = [round(float(x), 4) for x in hi - lo]

    per = {}
    for clip, a in r.anims.items():
        dur = a["duration"]
        N = max(8, int(round(dur * fps)))
        ts = np.arange(N + 1) / N * dur
        frames = [r.skinned(clip, min(t, dur - 1e-6)) for t in ts]
        V = np.stack([f[0] for f in frames])
        Jp = np.stack([f[1] for f in frames])
        d = {"duration": round(dur, 3)}
        d["min_y"] = float(V[..., 1].min())
        ext0 = (hi - lo).max()
        d["max_extent_ratio"] = float((V.max((0, 1)) - V.min((0, 1))).max() / ext0)
        d["finite"] = bool(np.isfinite(V).all())
        if not d["finite"]: bad(f"{clip}: non-finite vertices")
        if clip in ("idle", "walk", "run", "fly", "hover") and d["min_y"] < -0.03 * ext0: bad(f"{clip}: sinks {d['min_y']:.3f} below the ground")
        if d["max_extent_ratio"] > 2.6: bad(f"{clip}: mesh explodes (extent x{d['max_extent_ratio']:.1f})")
        if clip in LOOPS:
            d["loop_err"] = float(np.abs(V[0] - V[-1]).max())
            if d["loop_err"] > 1e-3 * ext0: bad(f"{clip}: loop is not closed ({d['loop_err']:.4f})")
        # bone angular speed from consecutive local rotations
        if a["ch"]:
            worst = 0.0
            for (node, path), (tt, v) in a["ch"].items():
                if path != "rotation" or len(v) < 2:
                    continue
                dots = np.clip(np.abs((v[1:] * v[:-1]).sum(1)), 0, 1)
                ang = 2 * np.arccos(dots) / np.maximum(np.diff(tt), 1e-6)
                worst = max(worst, float(ang.max()))
            d["max_bone_rad_s"] = round(worst, 2)
            if worst > 60 and clip not in ("hit", "attack", "attack-2", "die", "jump", "taunt"): bad(f"{clip}: joint flip? {worst:.0f} rad/s")
        per[clip] = d
        d["_Jp"] = Jp
    # foot slide
    if meta and meta.get("limbs", {}).get("legs"):
        names = [n_["name"] for n_ in r.nodes]
        for clip in ("walk", "run"):
            if clip not in per or clip not in (meta.get("speeds") or {}):
                continue
            speed = meta["speeds"][clip]
            Jp = per[clip]["_Jp"]
            dur = per[clip]["duration"]
            dt = dur / (len(Jp) - 1)
            slides = []
            for leg in meta["limbs"]["legs"]:
                # the planted joint is the one the IK chain ends on: take the lowest joint of the chain over the cycle
                chain = [names.index(x) for x in leg]
                jj = min(chain, key=lambda c: Jp[:, c, 1].min())
                y = Jp[:, jj, 1]
                stance = y < (y.min() + 0.012 * (hi - lo).max())
                z = Jp[:, jj, 2]
                vz = np.gradient(z, dt)
                if stance.sum() >= 3:
                    # foot in the world frame: the body advances at `speed`, so the foot's ground velocity is vz + speed
                    slides.append(float(np.abs(vz[stance] + speed).mean() / max(speed, 1e-6)))
            if slides and (meta.get("clipInfo", {}).get(clip, {}).get("duty") is not None):
                per[clip]["foot_slide_ratio"] = round(float(np.mean(slides)), 3)   # 0 = perfectly planted; 1 = slides at body speed
                if per[clip]["foot_slide_ratio"] > 0.35: bad(f"{clip}: feet slide (ratio {per[clip]['foot_slide_ratio']})")
    for d in per.values():
        d.pop("_Jp", None)
    rep["clips"] = per
    return rep
