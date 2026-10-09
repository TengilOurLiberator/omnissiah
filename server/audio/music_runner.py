#!/usr/bin/env python3
"""Text -> music runner (ACE-Step 1.5 turbo DiT, MIT; the 5Hz language model is NOT loaded). JSON lines, one request at a time.
Run with ~/audio/ace/bin/python.   {"cmd":"gen","id","prompt","seconds","seed","bpm","out"}
-> {"event":"result","id","ok","seconds","vram_peak_gb","sample_rate","channels"}   (stereo float32 wav, 48 kHz)"""
import json, os, sys, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_out = os.fdopen(os.dup(1), "w", buffering=1)
sys.stdout = sys.stderr


def emit(obj):
    _out.write(json.dumps(obj) + "\n")
    _out.flush()


SRC = os.path.expanduser("~/audio/src/ACE-Step-1.5")
sys.path.insert(0, SRC)
os.chdir(SRC)
os.environ.setdefault('HF_HOME', os.path.expanduser('~/audio/hfhome'))
os.environ.setdefault('HF_MODULES_CACHE', os.path.expanduser('~/audio/hfhome/modules'))
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
if os.path.isdir(os.path.join(SRC, "checkpoints", "acestep-v15-turbo")):
    os.environ.setdefault("HF_HUB_OFFLINE", "1")


def main():
    t0 = time.time()
    try:
        import torch, numpy as np, soundfile as sf
        from loguru import logger
        logger.remove()
        from acestep.handler import AceStepHandler
        from acestep.llm_inference import LLMHandler
        from acestep.inference import GenerationParams, GenerationConfig, generate_music
        dit = AceStepHandler()
        msg = dit.initialize_service(project_root=SRC, config_path="acestep-v15-turbo", device="cuda")
        llm = LLMHandler()  # never initialised: thinking=False keeps the language model out of memory
    except Exception as e:  # noqa
        traceback.print_exc()
        emit({"event": "fatal", "error": f"load failed: {e}"})
        return
    emit({"event": "ready", "model": "ACE-Step-1.5-turbo", "load_seconds": round(time.time() - t0, 1),
          "vram_gb": round(torch.cuda.memory_allocated() / 1e9, 2), "init": str(msg)[:200]})
    scorer = None
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
        if req.get("cmd") in ("bank", "score"):
            try:
                if scorer is None:
                    from clap_score import ClapScorer
                    scorer = ClapScorer()
                r = {"n": scorer.set_bank(req["prompts"])} if req["cmd"] == "bank" else scorer.score(req["wav"], req["prompt"])
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
            seed = int(req.get("seed") or 0) & 0x7fffffff
            params = GenerationParams(
                caption=req["prompt"], lyrics="[Instrumental]", instrumental=True,
                bpm=int(req["bpm"]) if req.get("bpm") else None, duration=float(max(10.0, req["seconds"])),
                inference_steps=int(req.get("steps") or 8), shift=3.0, thinking=False, seed=seed,
                use_cot_metas=False, use_cot_caption=False, use_cot_language=False, vocal_language="unknown")
            cfg = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[seed], audio_format="wav")
            res = generate_music(dit, llm, params, cfg, save_dir=os.path.dirname(req["out"]))
            if not res.success or not res.audios:
                raise RuntimeError(res.error or "no audio")
            au = res.audios[0]
            w = au["tensor"].float().cpu().numpy()  # [channels, samples]
            sf.write(req["out"], w.T, int(au["sample_rate"]), subtype="FLOAT")
            try:
                os.remove(au["path"])
            except Exception:
                pass
            emit({"event": "result", "id": req.get("id"), "ok": True, "seconds": round(time.time() - t, 2),
                  "vram_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "sample_rate": int(au["sample_rate"]),
                  "channels": int(w.shape[0])})
        except Exception as e:  # noqa
            traceback.print_exc()
            emit({"event": "result", "id": req.get("id"), "ok": False, "error": str(e)[:300]})
        finally:
            torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
