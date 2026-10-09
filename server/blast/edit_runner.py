#!/usr/bin/env python
"""Image-EDIT runner (FLUX.2 [klein] 4B, Apache-2.0) for the Omnissiah blast worker.

Runs in ~/blast/venv. JSON lines on stdin/stdout:
  -> {"cmd":"batch","id":"..","items":[{"id":"a","images":["/abs/in.png", ...],"prompt":"..","out":"/abs/out.png","seed":1,
                                        "width":1024,"height":1024,"steps":4,"guidance":1.0}, ...]}
  <- {"event":"ready"} | {"event":"item","id":"batch","item":"a","ok":true,"out":..,"seconds":..} ... | {"event":"result","id":"batch","ok":true,...}
  -> {"cmd":"quit"}

A batch is processed in three phases so that only one big model sits on the GPU at a time (the GPU is shared with other generators):
  1. the Qwen3 text encoder (~8 GB bf16) encodes every prompt, then is freed;
  2. the 4B DiT (~7.5 GB) + VAE are loaded once;
  3. every item is denoised (4 steps, distilled) and written; an `item` event follows each one so callers can start using results early.
Peak VRAM is ~9-10 GB. Nothing but the CUDA context stays on the GPU between batches (BLAST_EDIT_KEEP_WARM=1 keeps the DiT resident).
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

MODEL_DIR = os.environ.get("BLAST_EDIT_MODEL", os.path.expanduser("~/blast/klein4b"))
KEEP_WARM = os.environ.get("BLAST_EDIT_KEEP_WARM") == "1"


def drop_page_cache(directory):
    """WSL has ~20 GB of RAM for everybody: do not let the weights we just streamed to the GPU squat in the page cache."""
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
    from PIL import Image
    from diffusers import Flux2KleinPipeline, Flux2Transformer2DModel, AutoencoderKLFlux2, FlowMatchEulerDiscreteScheduler
    from transformers import Qwen3ForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(os.path.join(MODEL_DIR, "tokenizer"))
    sched = FlowMatchEulerDiscreteScheduler.from_pretrained(os.path.join(MODEL_DIR, "scheduler"))
    vae = AutoencoderKLFlux2.from_pretrained(os.path.join(MODEL_DIR, "vae"), torch_dtype=torch.bfloat16).to("cuda")
    dit_cache = {}
    torch.cuda.synchronize()
    emit({"event": "ready", "load_seconds": round(time.time() - t0, 1), "keep_warm": KEEP_WARM})

    def load_dit():
        if "dit" in dit_cache:
            return dit_cache["dit"]
        dit = Flux2Transformer2DModel.from_pretrained(os.path.join(MODEL_DIR, "transformer"), torch_dtype=torch.bfloat16, device_map="cuda")
        drop_page_cache(os.path.join(MODEL_DIR, "transformer"))
        if KEEP_WARM:
            dit_cache["dit"] = dit
        return dit

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
        if req.get("cmd") != "batch":
            continue
        rid = req.get("id")
        items = req.get("items") or []
        t1 = time.time()
        stats = {"encode_seconds": None, "load_seconds": None, "items": 0, "vram_peak_gb": 0.0}
        try:
            torch.cuda.reset_peak_memory_stats()
            # ---- phase 1: text
            te = Qwen3ForCausalLM.from_pretrained(os.path.join(MODEL_DIR, "text_encoder"), dtype=torch.bfloat16, device_map="cuda")
            drop_page_cache(os.path.join(MODEL_DIR, "text_encoder"))
            pipe = Flux2KleinPipeline(scheduler=sched, vae=vae, text_encoder=te, tokenizer=tok, transformer=None, is_distilled=True)
            embeds = {}
            with torch.no_grad():
                for it in items:
                    try:
                        pe, _ = pipe.encode_prompt(prompt=it["prompt"], device="cuda")
                        embeds[it["id"]] = pe.clone()
                    except Exception as e:
                        traceback.print_exc()
                        emit({"event": "item", "id": rid, "item": it["id"], "ok": False, "error": f"encode: {type(e).__name__}: {e}"})
            stats["vram_peak_gb"] = max(stats["vram_peak_gb"], torch.cuda.max_memory_allocated() / 2**30)
            del pipe, te
            gc.collect(); torch.cuda.empty_cache()
            stats["encode_seconds"] = round(time.time() - t1, 2)

            # ---- phase 2: DiT
            torch.cuda.reset_peak_memory_stats()
            t2 = time.time()
            dit = load_dit()
            stats["load_seconds"] = round(time.time() - t2, 2)
            pipe = Flux2KleinPipeline(scheduler=sched, vae=vae, text_encoder=None, tokenizer=tok, transformer=dit, is_distilled=True)
            pipe.set_progress_bar_config(disable=True)

            # ---- phase 3: denoise
            for it in items:
                if it["id"] not in embeds:
                    continue
                t3 = time.time()
                try:
                    imgs = [Image.open(p).convert("RGB") for p in it["images"]]
                    kw = {}
                    if it.get("width") and it.get("height"):
                        kw = {"width": int(it["width"]) // 16 * 16, "height": int(it["height"]) // 16 * 16}
                    gen = torch.Generator("cuda").manual_seed(int(it.get("seed") or 0))
                    out = pipe(image=imgs if len(imgs) > 1 else imgs[0], prompt_embeds=embeds[it["id"]],
                               num_inference_steps=int(it.get("steps") or 4), guidance_scale=float(it.get("guidance") or 1.0),
                               generator=gen, **kw).images[0]
                    out.save(it["out"])
                    stats["items"] += 1
                    emit({"event": "item", "id": rid, "item": it["id"], "ok": True, "out": it["out"], "seconds": round(time.time() - t3, 2)})
                except Exception as e:
                    traceback.print_exc()
                    gc.collect(); torch.cuda.empty_cache()
                    emit({"event": "item", "id": rid, "item": it["id"], "ok": False, "error": f"{type(e).__name__}: {e}"})
            stats["vram_peak_gb"] = round(max(stats["vram_peak_gb"], torch.cuda.max_memory_allocated() / 2**30), 2)
            del pipe
            if not KEEP_WARM:
                del dit
            gc.collect(); torch.cuda.empty_cache()
            emit({"event": "result", "id": rid, "ok": True, "seconds": round(time.time() - t1, 2), "stats": stats})
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
