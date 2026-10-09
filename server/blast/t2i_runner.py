#!/usr/bin/env python
"""Scene-image runner (Z-Image-Turbo, Apache-2.0) for the Omnissiah blast worker.

Runs in ~/blast/venv. JSON lines on stdin/stdout:
  -> {"cmd":"gen","id":"..","prompt":"..","width":1344,"height":768,"seed":1,"steps":9,"out":"/path.png"}
  <- {"event":"ready"} | {"event":"result","id":..,"ok":true,"out":..,"seconds":..,"vram_peak_gb":..}
  -> {"cmd":"quit"}

Reads the Z-Image-Turbo weights that gen3d installed (~/gen3d/zimage-turbo-bf16, READ ONLY). Same VRAM policy as gen3d's t2i_runner: text encoder
(~9 GB) then DiT (~13 GB) are streamed to the GPU one after the other and freed again, nothing but the CUDA context stays between jobs.
"""
import os, sys, json, time, traceback, gc

_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def emit(obj):
    _proto.write(json.dumps(obj) + "\n")
    _proto.flush()


os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

MODEL_DIR = os.environ.get("BLAST_T2I_MODEL", os.path.expanduser("~/gen3d/zimage-turbo-bf16"))


def drop_page_cache(directory):
    for dirpath, _, files in os.walk(directory):
        for name in files:
            try:
                fd = os.open(os.path.join(dirpath, name), os.O_RDONLY)
                try:
                    os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
                finally:
                    os.close(fd)
            except OSError:
                pass


def main():
    t0 = time.time()
    import torch
    from diffusers import ZImagePipeline, ZImageTransformer2DModel, AutoencoderKL, FlowMatchEulerDiscreteScheduler
    from transformers import AutoModel, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(os.path.join(MODEL_DIR, "tokenizer"))
    sched = FlowMatchEulerDiscreteScheduler.from_pretrained(os.path.join(MODEL_DIR, "scheduler"))
    vae = AutoencoderKL.from_pretrained(os.path.join(MODEL_DIR, "vae"), torch_dtype=torch.bfloat16).to("cuda")
    torch.cuda.synchronize()
    emit({"event": "ready", "load_seconds": round(time.time() - t0, 1)})

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
        if req.get("cmd") != "gen":
            continue
        rid = req.get("id")
        try:
            t1 = time.time()
            torch.cuda.reset_peak_memory_stats()
            prompt = str(req["prompt"])
            width, height = int(req.get("width") or 1344), int(req.get("height") or 768)
            width, height = width // 16 * 16, height // 16 * 16
            seed = int(req.get("seed") or 0)
            steps = int(req.get("steps") or 9)

            te = AutoModel.from_pretrained(os.path.join(MODEL_DIR, "text_encoder"), dtype=torch.bfloat16, device_map="cuda")
            drop_page_cache(os.path.join(MODEL_DIR, "text_encoder"))
            pipe = ZImagePipeline(scheduler=sched, vae=vae, text_encoder=te, tokenizer=tok, transformer=None)
            with torch.no_grad():
                pe, _ = pipe.encode_prompt(prompt=prompt, device="cuda", do_classifier_free_guidance=False)
            pe = [p.clone() for p in pe]
            peak_te = torch.cuda.max_memory_allocated() / 2**30
            del pipe, te
            gc.collect(); torch.cuda.empty_cache()

            torch.cuda.reset_peak_memory_stats()
            dit = ZImageTransformer2DModel.from_pretrained(os.path.join(MODEL_DIR, "transformer"), torch_dtype=torch.bfloat16, device_map="cuda")
            drop_page_cache(os.path.join(MODEL_DIR, "transformer"))
            pipe = ZImagePipeline(scheduler=sched, vae=vae, text_encoder=None, tokenizer=tok, transformer=dit)
            pipe.set_progress_bar_config(disable=True)
            gen = torch.Generator("cuda").manual_seed(seed)
            image = pipe(prompt_embeds=pe, height=height, width=width, num_inference_steps=steps, guidance_scale=0.0, generator=gen).images[0]
            peak_dit = torch.cuda.max_memory_allocated() / 2**30
            image.save(req["out"])
            del pipe, dit
            gc.collect(); torch.cuda.empty_cache()
            emit({"event": "result", "id": rid, "ok": True, "out": req["out"], "seconds": round(time.time() - t1, 2),
                  "vram_peak_gb": round(max(peak_te, peak_dit), 2)})
        except Exception as e:
            traceback.print_exc()
            gc.collect(); torch.cuda.empty_cache()
            emit({"event": "result", "id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        emit({"event": "fatal", "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
