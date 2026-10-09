#!/usr/bin/env python3
"""Text -> sound effect runner (MOSS-SoundEffect v2.0, Apache-2.0). JSON lines on stdin/stdout, one request at a time.
Run with ~/audio/moss/bin/python.   {"cmd":"gen","id","prompt","seconds","seed","steps","cfg","window","out"}
-> {"event":"result","id","ok","seconds","vram_peak_gb","sample_rate"}   (mono float32 wav at 48 kHz)"""
import json, os, sys, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_out = os.fdopen(os.dup(1), "w", buffering=1)  # private channel; anything the libraries print goes to stderr
sys.stdout = sys.stderr


def emit(obj):
    _out.write(json.dumps(obj) + "\n")
    _out.flush()


os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")  # no torch.compile: first call would take minutes, steady state is fast enough
HF = os.path.expanduser("~/audio/hf")
os.environ.setdefault("HF_HUB_CACHE", HF)
if os.path.isdir(os.path.join(HF, "models--OpenMOSS-Team--MOSS-SoundEffect-v2.0")):
    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # weights are local: never wait for the network
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")


def main():
    t0 = time.time()
    try:
        import torch, numpy as np, soundfile as sf
        from moss_soundeffect_v2 import MossSoundEffectPipeline
        pipe = MossSoundEffectPipeline.from_pretrained("OpenMOSS-Team/MOSS-SoundEffect-v2.0", torch_dtype=torch.bfloat16, device="cuda")
    except Exception as e:  # noqa
        traceback.print_exc()
        emit({"event": "fatal", "error": f"load failed: {e}"})
        return
    quiet = lambda it, **k: it
    from clap_score import ClapScorer
    scorer = ClapScorer()
    emit({"event": "ready", "model": "MOSS-SoundEffect-v2.0", "load_seconds": round(time.time() - t0, 1),
          "vram_gb": round(torch.cuda.memory_allocated() / 1e9, 2), "sample_rate": pipe.sample_rate})
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
        if req.get("cmd") in ("bank", "score"):  # CLAP: retrieval bank / similarity of a wav to its prompt
            try:
                if req["cmd"] == "bank":
                    r = {"n": scorer.set_bank(req["prompts"])}
                else:
                    r = scorer.score(req["wav"], req["prompt"])
                emit({"event": "result", "id": req.get("id"), "ok": True, **r})
            except Exception as e:  # noqa
                traceback.print_exc()
                emit({"event": "result", "id": req.get("id"), "ok": False, "error": str(e)[:300]})
            continue
        if req.get("cmd") != "gen":
            continue
        t = time.time()
        try:
            torch.cuda.reset_peak_memory_stats()
            sec = float(req["seconds"])
            win = int(req.get("window") or min(30, max(6, int(sec + 3.99))))
            a = pipe(prompt=req["prompt"], seconds=sec, num_inference_steps=int(req.get("steps") or 50),
                     cfg_scale=float(req.get("cfg") or 4.0), seed=int(req.get("seed") or 0), max_inference_seconds=win,
                     progress_bar_cmd=quiet)
            w = a[0, 0].detach().float().cpu().numpy()
            sf.write(req["out"], w, pipe.sample_rate, subtype="FLOAT")
            emit({"event": "result", "id": req.get("id"), "ok": True, "seconds": round(time.time() - t, 2),
                  "vram_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "sample_rate": pipe.sample_rate})
        except Exception as e:  # noqa
            traceback.print_exc()
            emit({"event": "result", "id": req.get("id"), "ok": False, "error": str(e)[:300]})
        finally:
            torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
