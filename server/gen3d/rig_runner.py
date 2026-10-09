#!/usr/bin/env python
"""Rigging runner for the Omnissiah gen3d worker (rig env: ~/rig/env, python 3.11, torch 2.7.1+cu128).

JSON lines on stdin/stdout, same protocol as trellis_runner.py:
  -> {"cmd":"rig","id":"..","glb":"/in.glb","out":"/out.glb","prompt":"a wolf","seed":1,"force":false}
  <- {"event":"ready",...} | {"event":"stage","id":..,"state":"sculpting","message":"Finding its bones"}
     | {"event":"result","id":..,"ok":true,"rigged":true,"glb":..,"meta":{...},"stats":{...}}
     | {"event":"result","ok":true,"rigged":false,"reason":..}   (static things: no limbs worth moving)
  -> {"cmd":"unload"} frees the UniRig weights (keeps the process) | {"cmd":"quit"}

Pipeline (see README): weld mesh -> UniRig skeleton (+ retry on a bad skeleton) -> UniRig skin weights -> clean-up (<= 36 bones,
smooth, <= 4 influences) -> body-plan analysis -> procedural clips -> skinned GLB with baked animation.
"""
import os, sys, json, time, traceback, gc

_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HOME", os.path.expanduser("~/rig/hf"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import numpy as np


def emit(obj):
    _proto.write(json.dumps(obj) + "\n")
    _proto.flush()


def rss_gb():
    try:
        with open("/proc/self/status") as fh:
            return round(sum(int(ln.split()[1]) for ln in fh if ln.startswith(("VmRSS", "VmSwap"))) / 2**20, 2)
    except Exception:
        return None


def trim_memory():
    gc.collect()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def fallback_skeleton(verts):
    """A generic vertical chain (base .. top) with height-based weights: always works, gives hop/sway motion only."""
    lo, hi = verts.min(0), verts.max(0)
    n = 5
    ys = np.linspace(lo[1] + 0.08 * (hi[1] - lo[1]), hi[1] - 0.08 * (hi[1] - lo[1]), n)
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    joints = np.array([[cx, y, cz] for y in ys])
    parents = [None] + list(range(n - 1))
    t = np.clip((verts[:, 1] - ys[0]) / max(ys[-1] - ys[0], 1e-6), 0, 1) * (n - 1)
    W = np.zeros((len(verts), n))
    lo_i = np.minimum(np.floor(t).astype(int), n - 2)
    f = t - lo_i
    W[np.arange(len(verts)), lo_i] = 1 - f
    W[np.arange(len(verts)), lo_i + 1] = f
    return dict(names=[f"bone_{i}" for i in range(n)], parents=parents, joints=joints), W


def main():
    t0 = time.time()
    import torch
    from rigkit import pipeline as pl, glb as G, skeleton as SK
    import unirig_engine as ue

    engine = ue.Engine(log=lambda *a: print(*a, file=sys.stderr, flush=True))
    emit({"event": "ready", "load_seconds": round(time.time() - t0, 1), "rss_gb": rss_gb()})
    log = lambda *a: print(*a, file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        cmd = req.get("cmd")
        if cmd == "quit":
            break
        if cmd == "unload":
            engine.unload(); trim_memory()
            emit({"event": "result", "id": req.get("id"), "ok": True, "rss_gb": rss_gb()})
            continue
        if cmd != "rig":
            continue
        rid = req.get("id")
        try:
            torch.cuda.reset_peak_memory_stats()
            stats = {}
            tt = time.time()
            static = G.load_static(req["glb"])
            wv, wf, inv = pl.weld(static["verts"], static["faces"])
            prompt = req.get("prompt") or ""
            emit({"event": "stage", "id": rid, "state": "sculpting", "message": "Finding its bones"})
            sk = skin = None
            tried = []
            best = None
            seeds = [int(req.get("seed") or 1)] + [s + 17 for s in range(2)]
            budget = float(req.get("budget") or 240)
            try:
                for si, seed in enumerate(seeds):
                    t1 = time.time()
                    cand = engine.skeleton(wv, wf, seed=seed)
                    nb = len(cand["names"])
                    tried.append(dict(seed=seed, bones=nb, seconds=cand["seconds"], symmetry=None))
                    if best is None or nb > len(best["names"]):
                        best = cand
                    # a usable skeleton: enough joints; otherwise try another seed while the budget allows
                    if nb >= 8 or time.time() - tt > budget * 0.45:
                        break
                sk = best
                stats["skeleton_seconds"] = round(time.time() - tt, 1)
                stats["skeleton_tries"] = tried
                t2 = time.time()
                skin = engine.skin(wv, wf, sk)["weights"]
                stats["skin_seconds"] = round(time.time() - t2, 1)
                stats["unirig_bones"] = len(sk["names"])
                stats["method"] = "unirig"
            except Exception as e:
                log("[rig] UniRig failed:", repr(e), traceback.format_exc())
                sk = None
            if sk is None or len(sk["names"]) < 3:
                sk, skin = fallback_skeleton(wv)
                stats["method"] = "fallback-chain"
                stats["unirig_bones"] = 0
            stats["vram_peak_gb"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)
            if req.get("debug_dir"):   # keep the raw UniRig result so classification / gait code can be iterated on the CPU
                try:
                    os.makedirs(req["debug_dir"], exist_ok=True)
                    np.savez(os.path.join(req["debug_dir"], "unirig.npz"), verts=wv, faces=wf, joints=sk["joints"], parents=np.array([-1 if p is None else p for p in sk["parents"]]),
                             names=np.array(sk["names"]), weights=skin)
                except Exception as e:
                    log("[rig] could not save debug npz:", e)
            emit({"event": "stage", "id": rid, "state": "sculpting", "message": "Teaching it to walk"})
            t3 = time.time()
            res = pl.rig_gated(req["glb"], req["out"], wv, wf, inv, sk, skin, prompt, log=log)
            stats["method"] = res.get("method", stats.get("method"))
            plan = res["plan"]
            kind = plan["body_plan"]
            stats["rig_seconds"] = round(time.time() - t3, 2)
            stats["body_plan"] = kind
            if kind == "plant" and not req.get("force"):
                emit({"event": "result", "id": rid, "ok": True, "rigged": False, "reason": "plant-like: kept static", "stats": stats, "body_plan": kind})
                continue
            meta = pl.build_meta(res, prompt)
            size = pl.write_result(res, inv, req["out"], meta={"bodyPlan": kind, "clips": [c["name"] for c in res["clips"]]})
            meta["bytes"] = size
            from rigkit import validate
            rep = validate.check(req["out"], meta, log=log)
            stats["validation"] = {"ok": rep["ok"], "problems": rep["problems"], "numbers": rep["numbers"],
                                   "clips": {k: {a: b for a, b in v.items() if a in ("loop_err", "foot_slide_ratio", "max_bone_rad_s", "min_y")} for k, v in rep["clips"].items()}}
            severe = [p for p in rep["problems"] if any(w in p for w in ("NaN", "unbound", "bind pose", "explodes", "non-finite", "out of range"))]
            if severe:
                emit({"event": "result", "id": rid, "ok": True, "rigged": False, "reason": "rig failed validation: " + "; ".join(severe[:3]), "stats": stats, "body_plan": kind})
                continue
            stats["total_seconds"] = round(time.time() - tt, 1)
            stats["rss_gb"] = rss_gb()
            if req.get("debug_dir"):
                pl.debug_dump(res, req["debug_dir"], wf)
            emit({"event": "result", "id": rid, "ok": True, "rigged": True, "glb": req["out"], "meta": meta, "stats": stats})
            torch.cuda.empty_cache(); trim_memory()
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
