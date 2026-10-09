#!/usr/bin/env python
"""Text -> image runner (Z-Image-Turbo, Apache-2.0) for the Omnissiah gen3d worker.

Runs in its OWN python environment (~/gen3d/env). Speaks JSON lines on stdin/stdout:
  -> {"cmd":"gen","id":"..","prompt":"..","seed":1,"out":"/path.png","size":1024}
  <- {"event":"ready", ...} | {"event":"result","id":..,"ok":true,"image":..,"seconds":..,"vram_peak_gb":..}
  -> {"cmd":"quit"}

VRAM policy: this process must not sit on the GPU between jobs (TRELLIS.2 needs the room, and so does a
game running on the same card). Checkpoints are stored as bf16 on a fast disk (12 GB DiT + 7.5 GB Qwen3
text encoder, ~2.5 GB/s), so each job streams them straight into VRAM one after the other, uses them and
frees them again: peak ~9 GB (encoder) and ~14 GB (DiT), never both at once; idle footprint ~1 GB (CUDA
context + 0.2 GB VAE). Set GEN3D_T2I_KEEP_WARM=1 to keep them resident instead (~20 GB) if you have the room.
"""
import os, sys, json, time, traceback, gc

# Keep fd 1 for the protocol; anything a library prints to stdout goes to stderr instead.
_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def emit(obj):
    _proto.write(json.dumps(obj) + "\n")
    _proto.flush()


os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

MODEL_DIR = os.environ.get("GEN3D_T2I_MODEL", os.path.expanduser("~/gen3d/zimage-turbo-bf16"))
KEEP_WARM = os.environ.get("GEN3D_T2I_KEEP_WARM") == "1"

# The wrapper that turns a player's wish into an image TRELLIS.2 can lift into a clean 3D object.
# (Picked from three templates tried on six varied subjects: this one gave a white seamless backdrop, no
# cast shadows, a 3/4 view with the whole object in frame and soft clay-like stylised materials.)
TEMPLATE = os.environ.get(
    "GEN3D_T2I_TEMPLATE",
    "{subject}. Isolated product shot of a single stylised 3D game prop, entire object in frame, "
    "3/4 view, matte clay-like materials, bright saturated colours, flat even lighting, seamless "
    "pure white studio backdrop, no ground plane, no cast shadow, no text, no other objects",
)


def drop_page_cache(directory):
    """Tell the kernel the checkpoint files we just streamed to the GPU need not stay cached. WSL has only
    ~20 GB of RAM; 20 GB of t2i weights in the page cache would evict TRELLIS.2's weights (which stay on the
    CPU between its stages) and make every TRELLIS stage re-read them from disk."""
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


def build_prompt(subject):
    subject = " ".join(str(subject).split()).strip().rstrip(".,;:!")
    if not subject.lower().startswith(("a ", "an ", "the ", "some ", "two ", "three ")):
        subject = "A " + subject
    subject = subject[0].upper() + subject[1:]
    return TEMPLATE.format(subject=subject)


def main():
    t0 = time.time()
    import torch
    from diffusers import ZImagePipeline, ZImageTransformer2DModel, AutoencoderKL, FlowMatchEulerDiscreteScheduler
    from transformers import AutoModel, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(os.path.join(MODEL_DIR, "tokenizer"))
    sched = FlowMatchEulerDiscreteScheduler.from_pretrained(os.path.join(MODEL_DIR, "scheduler"))
    vae = AutoencoderKL.from_pretrained(os.path.join(MODEL_DIR, "vae"), torch_dtype=torch.bfloat16).to("cuda")
    cache = {}

    def load_te():
        if "te" in cache:
            return cache["te"]
        te = AutoModel.from_pretrained(os.path.join(MODEL_DIR, "text_encoder"), dtype=torch.bfloat16, device_map="cuda")
        drop_page_cache(os.path.join(MODEL_DIR, "text_encoder"))
        if KEEP_WARM:
            cache["te"] = te
        return te

    def load_dit():
        if "dit" in cache:
            return cache["dit"]
        dit = ZImageTransformer2DModel.from_pretrained(os.path.join(MODEL_DIR, "transformer"),
                                                       torch_dtype=torch.bfloat16, device_map="cuda")
        drop_page_cache(os.path.join(MODEL_DIR, "transformer"))
        if KEEP_WARM:
            cache["dit"] = dit
        return dit

    torch.cuda.synchronize()
    emit({"event": "ready", "load_seconds": round(time.time() - t0, 1),
          "vram_gb": round(torch.cuda.memory_allocated() / 2**30, 2), "keep_warm": KEEP_WARM})

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
            prompt = req.get("raw_prompt") or build_prompt(req["prompt"])
            size = int(req.get("size") or 1024)
            seed = int(req.get("seed") or 0)
            steps = int(req.get("steps") or 9)  # 9 -> 8 DiT forwards for the Turbo model

            te = load_te()
            t_te = time.time() - t1
            pipe = ZImagePipeline(scheduler=sched, vae=vae, text_encoder=te, tokenizer=tok, transformer=None)
            with torch.no_grad():
                pe, _ = pipe.encode_prompt(prompt=prompt, device="cuda", do_classifier_free_guidance=False)
            pe = [p.clone() for p in pe]
            peak_te = torch.cuda.max_memory_allocated() / 2**30
            del pipe
            if not KEEP_WARM:
                del te
                gc.collect()
                torch.cuda.empty_cache()
            t_enc = time.time() - t1

            torch.cuda.reset_peak_memory_stats()
            t2 = time.time()
            dit = load_dit()
            t_dit = time.time() - t2
            pipe = ZImagePipeline(scheduler=sched, vae=vae, text_encoder=None, tokenizer=tok, transformer=dit)
            pipe.set_progress_bar_config(disable=True)
            gen = torch.Generator("cuda").manual_seed(seed)
            image = pipe(prompt_embeds=pe, height=size, width=size, num_inference_steps=steps,
                         guidance_scale=0.0, generator=gen).images[0]
            peak_dit = torch.cuda.max_memory_allocated() / 2**30
            image.save(req["out"])
            del pipe
            if not KEEP_WARM:
                del dit
            gc.collect()
            torch.cuda.empty_cache()
            emit({"event": "result", "id": rid, "ok": True, "image": req["out"], "prompt_used": prompt,
                  "seconds": round(time.time() - t1, 2), "encode_seconds": round(t_enc, 2),
                  "load_seconds": round(t_te + t_dit, 2), "generate_seconds": round(time.time() - t2 - t_dit, 2),
                  "vram_peak_gb": round(max(peak_te, peak_dit), 2)})
        except Exception as e:  # keep the runner alive for the next job
            traceback.print_exc()
            gc.collect()
            torch.cuda.empty_cache()
            emit({"event": "result", "id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        emit({"event": "fatal", "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
