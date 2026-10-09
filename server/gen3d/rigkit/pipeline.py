"""Static GLB -> rigged GLB with baked clips. Glue between UniRig (or the geometric fallback), analysis, gait and glb."""
import json
import os
import time
import numpy as np
from . import glb as G
from . import mathx as mx
from . import skeleton as SK
from . import analysis as AN
from . import gait as GA

MAX_BONES = 40


def weld(verts, faces, tol=1e-5):
    key = np.round(verts / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    wv = verts[first]
    wf = inv[faces]
    ok = (wf[:, 0] != wf[:, 1]) & (wf[:, 1] != wf[:, 2]) & (wf[:, 0] != wf[:, 2])
    return wv, wf[ok], inv


def _shift(x, k):
    if isinstance(x, (list, tuple)):
        return [_shift(v, k) for v in x]
    if isinstance(x, (int, np.integer)):
        return int(x) + k
    return x


def shift_plan(plan, k):
    """indices in the plan move by k (a new ground-root bone was inserted before everything)"""
    out = dict(plan)
    for name in ("spine", "central"):
        out[name] = [int(i) + k for i in plan[name]]
    out["head_joint"] = int(plan["head_joint"]) + k
    out["head_leaf"] = int(plan["head_leaf"]) + k
    for name in ("legs", "arms", "wings", "tails", "accessories"):
        L = []
        for d in plan[name]:
            d = dict(d)
            for key in ("root", "anchor"):
                if key in d:
                    d[key] = int(d[key]) + k
            for key in ("chain", "sub"):
                if key in d:
                    d[key] = [int(i) + k for i in d[key]]
            L.append(d)
        out[name] = L
    return out


def name_bones(plan, J):
    names = [f"bone_{j}" for j in range(J)]
    names[0], names[1] = "root", "hips"
    for k, j in enumerate([j for j in plan["spine"] if j > 1]):
        names[j] = f"spine_{k}"
    names[plan["head_joint"]] = "head"
    for ti, t in enumerate(plan["tails"]):
        for k, j in enumerate(t["chain"][1:]):
            names[j] = f"tail{ti}_{k}" if len(plan["tails"]) > 1 else f"tail_{k}"
    for kind, lst in (("leg", plan["legs"]), ("arm", plan["arms"]), ("wing", plan["wings"])):
        for d in lst:
            side = "L" if d["side"] > 0 else "R"
            tag = f"{kind}{side}{d.get('row', 0)}" if kind == "leg" else f"{kind}{side}"
            for k, j in enumerate(d["chain"][1:]):
                if names[j].startswith("bone_"):
                    names[j] = f"{tag}_{k}"
    used = set()
    for j in range(J):
        n = names[j]
        while n in used:
            n += "_"
        used.add(n)
        names[j] = n
    return names


def build_rig(skel, W, verts, faces, prompt, log=print):
    """Cleaned skeleton + dense weights -> (final names, parents, rest, plan, verts, weights (N,Jfinal)).
    Adds the ground root bone (0) and a mouth bone; verts/rest are rotated to face +Z."""
    plan = AN.analyse(skel, verts, W, faces, prompt, log=log)
    rest, v2 = plan["rest"], plan["verts"]
    # recentre x/z on the bounding box, base at y = 0 (rotation may have moved them)
    lo, hi = v2.min(0), v2.max(0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    v2 = v2 + shift
    rest = rest + shift
    for key in ("cx", "cz"):
        plan[key] = 0.0
    plan["lo"], plan["hi"] = [float(x) for x in v2.min(0)], [float(x) for x in v2.max(0)]
    plan["shift"] = [float(x) for x in shift]
    J0 = skel.n
    parents = np.concatenate([[-1], skel.parents + 1])
    parents[1] = 0
    full_rest = np.concatenate([[[0.0, 0.0, 0.0]], rest], 0)
    pl = shift_plan(plan, 1)
    pl["rest"], pl["verts"] = full_rest, v2
    Wf = np.concatenate([np.zeros((W.shape[0], 1)), W], 1)   # ground root has no skin
    # mouth bone: leaf under the head, no weights
    head = pl["head_joint"]
    mouth = np.asarray(plan["mouth"]) + shift if plan.get("mouth") is not None else full_rest[head] + np.array([0, 0, 0.05 * plan["dims"]["size"]])
    names = name_bones(pl, J0 + 1) + ["Mouth"]
    parents = np.concatenate([parents, [head]])
    full_rest = np.concatenate([full_rest, mouth[None]], 0)
    Wf = np.concatenate([Wf, np.zeros((Wf.shape[0], 1))], 1)
    pl["rest"] = full_rest
    pl["mouth_bone"] = len(names) - 1
    return names, parents, full_rest, pl, v2, Wf


def ground_fix(rig, anim, max_lift=0.04):
    """Lift the whole body a little when a pose pushes part of the mesh (tail, belly) below the ground. Capped so planted feet never float far."""
    sk = getattr(rig, "skin", None)
    if sk is None:
        return
    idx, w, pts = sk
    W, P = anim.fk()
    rest = rig.rest
    T = anim.T
    low = np.full(T, 1e9)
    for k in range(4):
        j = idx[:, k]
        # skinned position of vertex v with bone j: P_j + W_j (v - rest_j)
        pos = P[:, j] + mx.qrot(W[:, j], (pts - rest[j])[None])
        y = pos[..., 1] if k == 0 else None
        if k == 0:
            acc = w[None, :, k, None] * pos
        else:
            acc = acc + w[None, :, k, None] * pos
    low = acc[..., 1].min(1)
    lift = np.clip(-low, 0, max_lift * rig.size)
    # smooth over time so the body does not twitch
    if T > 4:
        lift = np.convolve(np.pad(lift, 2, mode="edge"), np.ones(5) / 5, mode="valid")
    anim.rootT[:, 1] += lift


def make_all_clips(rig, want=None, log=print):
    """-> list of clip dicts (name, ts, rot, trans, scale, loop) and a metadata dict (speeds ...)."""
    clips, info = [], {}

    def add(name, builder, loop, **kw):
        try:
            anim, dur, meta = builder()
        except Exception as e:  # a failing clip must not lose the model
            import traceback
            log(f"[rig] clip {name} failed: {e}\n{traceback.format_exc()}")
            return
        ts, _ = GA.times(dur)
        ground_fix(rig, anim)
        if loop:   # exact loop closure
            for arr in (anim.D, anim.rootT, anim.rootS):
                arr[-1] = arr[0]
        clips.append(dict(name=name, ts=ts, rot=anim.local_quats(), trans=anim.rootT.copy(), scale=anim.rootS.copy(), loop=loop, duration=float(ts[-1]), meta=meta))
        info[name] = dict(duration=float(ts[-1]), loop=loop, **meta)

    kind = rig.kind
    add("idle", lambda: GA.idle(rig), True)
    legged = bool(rig.legs) and kind in ("biped", "quadruped", "multileg", "winged")
    if legged and rig.stubby:
        add("walk", lambda: GA.hop(rig, False), True)
        add("run", lambda: GA.hop(rig, True), True)
    elif legged:
        add("walk", lambda: GA.walk_legged(rig, False), True)
        add("run", lambda: GA.walk_legged(rig, True), True)
    elif kind == "serpent":
        add("walk", lambda: GA.slither(rig, False), True)
        add("run", lambda: GA.slither(rig, True), True)
    elif kind == "blob":
        add("walk", lambda: GA.hop(rig, False), True)
        add("run", lambda: GA.hop(rig, True), True)
    elif kind == "floating":
        add("walk", lambda: GA.glide(rig, False), True)
        add("run", lambda: GA.glide(rig, True), True)
        add("hover", lambda: GA.glide(rig, False), True)
    elif kind == "vehicle":
        add("walk", lambda: GA.vehicle_drive(rig, False), True)
        add("run", lambda: GA.vehicle_drive(rig, True), True)
    elif kind == "winged":   # winged without usable legs
        add("walk", lambda: GA.fly(rig, True), True)
        add("run", lambda: GA.fly(rig, False), True)
    if kind == "winged":
        add("fly", lambda: GA.fly(rig, False), True)
        add("hover", lambda: GA.fly(rig, True), True)
    if kind == "plant":
        add("wind", lambda: GA.plant_sway(rig, True), True)
    else:
        add("attack", lambda: GA.attack(rig, 1), False)
        add("attack-2", lambda: GA.attack(rig, 2), False)
    if rig.legs and kind in ("biped", "quadruped", "multileg", "winged"):
        add("jump", lambda: GA.jump(rig), False)
        add("taunt", lambda: GA.taunt(rig), False)
    if kind == "biped" and rig.arms:   # people: the small repertoire kit's wave / cheer / dance states ask for
        add("wave", lambda: GA.wave(rig), True)
        add("cheer", lambda: GA.cheer(rig), True)
        add("dance", lambda: GA.dance(rig), True)
        add("bow", lambda: GA.bow(rig), False)
    add("hit", lambda: GA.hit(rig), False)
    add("die", lambda: GA.die(rig), False)
    return clips, info


def write_result(res, inv, glb_out, meta=None):
    """Write the rigged GLB. `inv` maps original (UV-split) vertices to the welded ones the skin weights belong to."""
    static, plan = res["static"], res["plan"]
    shift = np.asarray(plan["shift"])
    yaw = plan["yaw_final"]
    verts = AN.rotate_y(static["verts"], yaw) + shift if abs(yaw) > 1e-9 else static["verts"] + shift
    normals = None
    if static.get("normals") is not None:
        normals = AN.rotate_y(static["normals"], yaw) if abs(yaw) > 1e-9 else static["normals"]
    jidx_w, jw_w = SK.topk_weights(res["weights"], 4, 0.02)
    jidx, jw = jidx_w[inv], jw_w[inv]
    clips = [dict(name=c["name"], ts=c["ts"], rot=c["rot"], trans=c["trans"], scale=c["scale"]) for c in res["clips"]]
    size = G.write_rigged(glb_out, static, verts, normals, jidx, jw, res["names"], res["parents"], res["rest"], clips, meta)
    res["jidx"], res["jw"], res["out_verts"], res["bytes"] = jidx, jw, verts, size
    return size


def build_meta(res, prompt=""):
    plan, names, rest = res["plan"], res["names"], res["rest"]
    ci = res["clip_info"]
    v = res["verts"]
    ext = v.max(0) - v.min(0)
    speeds = {k: round(float(ci[k]["speed"]), 4) for k in ("walk", "run", "fly") if k in ci and ci[k].get("speed")}
    limbs = {}
    for key, lst in (("legs", plan["legs"]), ("arms", plan["arms"]), ("wings", plan["wings"]), ("tails", plan["tails"])):
        limbs[key] = [[names[j] for j in d["chain"][1:]] for d in lst]
    mouth = rest[plan["mouth_bone"]]
    return {
        "rigged": True, "bodyPlan": plan["body_plan"], "humanoid": bool(plan.get("humanoid")),
        "bodyPlanReason": plan["body_plan_reason"], "clips": [c["name"] for c in res["clips"]],
        "height": round(float(ext[1]), 4), "size": [round(float(x), 4) for x in ext], "speeds": speeds,
        "headBone": names[plan["head_joint"]], "mouthBone": names[plan["mouth_bone"]], "mouth": [round(float(x), 4) for x in mouth],
        "bones": len(names), "limbs": limbs, "counts": {"legs": plan["n_legs"], "arms": plan["n_arms"], "wings": plan["n_wings"], "tails": plan["n_tails"]},
        "facing": "+z", "yawApplied": round(float(plan["yaw_final"]), 4), "upright": bool(plan.get("upright")),
        "events": {k: {"hit": v["hit_time"]} for k, v in ci.items() if "hit_time" in v},
        "clipInfo": {k: {a: (round(b, 4) if isinstance(b, float) else b) for a, b in v.items()} for k, v in ci.items()},
    }


def debug_dump(res, d, faces):
    """rig overlay sheet (skeleton coloured by role) + skin-weight sheet for the verification report"""
    from . import viz
    os.makedirs(d, exist_ok=True)
    plan = res["plan"]
    cols = {}
    for k, c in (("legs", (0, 140, 0)), ("arms", (0, 80, 220)), ("wings", (220, 120, 0)), ("tails", (160, 0, 160)), ("accessories", (120, 120, 120))):
        for l in plan[k]:
            for j in l["chain"][1:]:
                cols[j] = c
    for j in plan["spine"]:
        cols[j] = (220, 0, 0)
    cols[plan["mouth_bone"]] = (255, 200, 0)
    ims = viz.rig_overlay(res["verts"], faces, res["rest"], list(res["parents"]), None, marks=cols, size=320)
    ims += viz.rig_overlay(res["verts"], faces, res["rest"], list(res["parents"]), res["weights"], size=320)
    viz.sheet(ims, 4).save(os.path.join(d, "rig.png"))


def gate_geometry(res):
    """Does UniRig's skeleton agree with the feet the mesh actually has? Returns the foot count to rebuild with, or None."""
    from . import geomrig
    pl = res["plan"]
    if pl["body_plan"] in ("serpent", "floating", "plant", "vehicle"):
        return None
    n_c, _ = geomrig.foot_clusters(res["verts"])
    nl, nw = pl["n_legs"], pl["n_wings"]
    if not (3 <= n_c <= 8) or abs(nl - n_c) < 2:
        return None
    if nw >= 2 and nw % 2 == 0:      # a real pair of wings: keep the neural skeleton
        return None
    return n_c


def rig_gated(glb_in, glb_out, wv, wf, inv, sk, skin_w, prompt, log=print, clips_wanted=None):
    """rig_from_skeleton + the geometry gate: when the neural skeleton does not fit the feet, rebuild it geometrically."""
    res = rig_from_skeleton(glb_in, glb_out, wv, wf, inv, sk, skin_w, prompt, log=log, clips_wanted=clips_wanted)
    res["method"] = "unirig"
    n = gate_geometry(res)
    if n:
        from . import geomrig
        try:
            gsk, gW = geomrig.geometric_rig(wv, wf, n_legs=n if n % 2 == 0 else n + 1, log=log)
            res2 = rig_from_skeleton(glb_in, glb_out, wv, wf, inv, gsk, gW, prompt, log=log, clips_wanted=clips_wanted)
            if res2["plan"]["n_legs"] >= 3 and abs(res2["plan"]["n_legs"] - n) <= 1:
                log(f"[rig] UniRig skeleton ({res['plan']['n_legs']} legs, {res['plan']['n_wings']} wings) disagrees with {n} feet: using the geometric rig ({res2['plan']['n_legs']} legs)")
                res2["method"] = "geometric"
                res2["unirig_plan"] = res["plan"]["body_plan"]
                return res2
            log(f"[rig] geometric rig not better ({res2['plan']['n_legs']} legs vs {n} feet): keeping UniRig")
        except Exception as e:
            log(f"[rig] geometric rig failed: {e}")
    return res


def rig_from_skeleton(glb_in, glb_out, wv, wf, inv, sk, skin_w, prompt, log=print, clips_wanted=None):
    static = G.load_static(glb_in)
    t0 = time.time()
    skel = SK.Skeleton(sk["names"], sk["parents"], sk["joints"])
    S2, W2, rep = SK.clean(skel, skin_w, wv, wf, max_bones=MAX_BONES - 3)
    log(f"[rig] cleaned skeleton {rep['input_bones']} -> {rep['bones']} bones")
    W2 = SK.smooth_weights(W2, wf, iters=1, alpha=0.35)
    W2 = W2 / (W2.sum(1, keepdims=True) + 1e-12)
    names, parents, rest, plan, v2, Wf = build_rig(S2, W2, wv, wf, prompt, log)
    rig = GA.Rig(names, parents, rest, plan, v2)
    ji, jw = SK.topk_weights(Wf, 4, 0.02)
    sel = np.arange(0, len(v2), max(1, len(v2) // 2500))
    rig.skin = (ji[sel], jw[sel], v2[sel])
    clips, info = make_all_clips(rig, clips_wanted, log)
    return dict(static=static, names=names, parents=parents, rest=rest, plan=plan, verts=v2, weights=Wf, clips=clips, clip_info=info, rig=rig, clean_report=rep)
