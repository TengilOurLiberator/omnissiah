#!/usr/bin/env python
"""Omnissiah travel: text -> seamless equirectangular 360 panorama with Z-Image-Turbo (Apache-2.0, already installed for gen3d).

Runs in its OWN venv (~/travel/venv, --system-site-packages of ~/gen3d/env, so torch/diffusers are shared read-only; the
gen3d install is never modified). Speaks JSON lines on stdin/stdout, like gen3d/t2i_runner.py:

  -> {"cmd":"gen","id":..,"prompt":"..","seed":1,"out":"/path/base.png","width":2048,"height":1024}
  <- {"event":"ready", ...} | {"event":"result","id":..,"ok":true,"image":..,"seconds":..,"vram_peak_gb":..,"fp8":bool}
  -> {"cmd":"refine","id":..,"image":"/path/base.png","prompt":"..","seed":1,"out":"/path/hi.png","width":4096,"height":2048,"strength":0.35}
  -> {"cmd":"quit"}

SEAMLESS WRAP (the part that matters): Z-Image is a transformer (no convolutions to give circular padding), so the horizontal
wrap is enforced on the LATENT instead. The latent canvas is the panorama width plus PAD columns on each side, the initial noise
is periodic, and after every denoising step the pad columns and the opposite edge of the core are averaged into the same values
(callback_on_step_end). The model therefore always sees real context on both sides of the seam, and the core is periodic by
construction. The VAE decodes the padded latent and the pad is cropped afterwards (the decoder's receptive field is smaller than
the pad), so the wrap is clean through the decoder as well. Poles are not special for the model; the post step (analyze.py)
blends the top/bottom rows toward a row mean so nothing pinches at the zenith.

VRAM policy as gen3d: encoder and DiT never sit on the GPU together or between jobs. When less than ~18 GB are free the DiT's big
linear layers are kept as float8_e4m3 (+ per-tensor scale) and up-cast per call: peak ~8 GB instead of ~14 GB (slightly softer).
"""
import os, sys, json, time, traceback, gc, math

_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def emit(obj):
    _proto.write(json.dumps(obj) + "\n")
    _proto.flush()


os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

MODEL_DIR = os.environ.get("TRAVEL_T2I_MODEL", os.path.expanduser("~/gen3d/zimage-turbo-bf16"))
FP8_BELOW_GB = float(os.environ.get("TRAVEL_FP8_BELOW_GB", "18"))  # force fp8 with TRAVEL_FORCE_FP8=1
FORCE_FP8 = os.environ.get("TRAVEL_FORCE_FP8") == "1"
PAD = 16  # latent columns on each side (x8 = 128 px at 2048 wide)

TEMPLATE = os.environ.get(
    "TRAVEL_TEMPLATE",
    "A seamless equirectangular 360 degree panorama of {subject}. Full spherical environment map, wide sweeping vista, "
    "the horizon is a straight level line exactly across the middle of the image, sky and distant scenery above it, "
    "ground below it, no people, no characters, no text, no watermark, no border, painterly stylised digital art, "
    "rich atmospheric lighting, soft haze toward the horizon, highly detailed",
)


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


def build_prompt(subject):
    subject = " ".join(str(subject).split()).strip().rstrip(".,;:!")
    return TEMPLATE.format(subject=subject)


def main():
    t0 = time.time()
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from diffusers import ZImagePipeline, ZImageImg2ImgPipeline, ZImageTransformer2DModel, AutoencoderKL, FlowMatchEulerDiscreteScheduler
    from transformers import AutoModel, AutoTokenizer
    import numpy as np
    from PIL import Image

    tok = AutoTokenizer.from_pretrained(os.path.join(MODEL_DIR, "tokenizer"))
    sched = FlowMatchEulerDiscreteScheduler.from_pretrained(os.path.join(MODEL_DIR, "scheduler"))
    vae = AutoencoderKL.from_pretrained(os.path.join(MODEL_DIR, "vae"), torch_dtype=torch.bfloat16).to("cuda")
    vae.enable_tiling()  # only kicks in for the 4096-wide decode; tiles blend, the periodic pad is wider than a tile overlap

    class FP8Linear(nn.Module):
        def __init__(self, lin):
            super().__init__()
            w = lin.weight.data
            self.scale = float(w.float().abs().max().clamp(min=1e-8) / 448.0)
            self.register_buffer("w8", (w.float() / self.scale).to(torch.float8_e4m3fn), persistent=False)
            self.bias = lin.bias
            self.in_features, self.out_features = lin.in_features, lin.out_features

        def forward(self, x):
            w = self.w8.to(x.dtype) * self.scale
            return F.linear(x, w, None if self.bias is None else self.bias.to(x.dtype))

    def to_fp8(mod):
        n = 0
        for name, child in list(mod.named_children()):
            if isinstance(child, nn.Linear) and child.weight.numel() > 1_000_000:
                setattr(mod, name, FP8Linear(child))
                n += 1
            else:
                n += to_fp8(child)
        return n

    def free_gb():
        f, _ = torch.cuda.mem_get_info()
        return f / 2**30

    def load_te():
        te = AutoModel.from_pretrained(os.path.join(MODEL_DIR, "text_encoder"), dtype=torch.bfloat16, device_map="cuda")
        drop_page_cache(os.path.join(MODEL_DIR, "text_encoder"))
        return te

    def load_dit():
        fp8 = FORCE_FP8 or free_gb() < FP8_BELOW_GB
        if fp8:
            # load to the CPU first (bf16, 12 GB of RAM for a few seconds), quantise layer by layer on the GPU
            dit = ZImageTransformer2DModel.from_pretrained(os.path.join(MODEL_DIR, "transformer"), torch_dtype=torch.bfloat16)
            dit.to("cuda") if False else None
            # move one block at a time so the bf16 copy never sits fully on the GPU
            for name, child in list(dit.named_children()):
                if isinstance(child, nn.ModuleList):
                    for i, blk in enumerate(child):
                        blk.to("cuda")
                        to_fp8(blk)
                        torch.cuda.empty_cache()
                else:
                    child.to("cuda")
                    to_fp8(child)
            for p in dit.parameters():
                if p.device.type != "cuda":
                    p.data = p.data.to("cuda")
            for b in dit.buffers():
                if b.device.type != "cuda":
                    b.data = b.data.to("cuda")
        else:
            dit = ZImageTransformer2DModel.from_pretrained(os.path.join(MODEL_DIR, "transformer"),
                                                           torch_dtype=torch.bfloat16, device_map="cuda")
        drop_page_cache(os.path.join(MODEL_DIR, "transformer"))
        return dit, fp8

    def encode(prompt):
        te = load_te()
        pipe = ZImagePipeline(scheduler=sched, vae=vae, text_encoder=te, tokenizer=tok, transformer=None)
        with torch.no_grad():
            pe, _ = pipe.encode_prompt(prompt=prompt, device="cuda", do_classifier_free_guidance=False)
        pe = [p.clone() for p in pe]
        del pipe, te
        gc.collect()
        torch.cuda.empty_cache()
        return pe

    def make_canvas(path, W, H, hfov_deg, horizon_y=0.5):
        """place a picture on the equirectangular canvas as a rectilinear view centred on -Z (u = 0.5, horizon = middle row).
        returns (canvas uint8 HxWx3 with grey where nothing is known, known float HxW in 0..1)"""
        import cv2, math
        src = np.asarray(Image.open(path).convert("RGB"))
        ih, iw = src.shape[:2]
        hfov = math.radians(min(150.0, max(30.0, float(hfov_deg))))
        f = 0.5 * iw / math.tan(hfov / 2)                      # focal length in source pixels
        u = (np.arange(W) + 0.5) / W
        v = (np.arange(H) + 0.5) / H
        lon = (u - 0.5) * 2 * math.pi
        lat = (0.5 - v) * math.pi
        LON, LAT = np.meshgrid(lon, lat)
        dx, dy, dz = np.sin(LON) * np.cos(LAT), np.sin(LAT), -np.cos(LON) * np.cos(LAT)
        front = dz < -1e-4
        with np.errstate(divide="ignore", invalid="ignore"):
            mx = np.where(front, iw / 2 + f * dx / -dz, -1).astype(np.float32)
            my = np.where(front, ih * horizon_y - f * dy / -dz, -1).astype(np.float32)
        warped = cv2.remap(src, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(127, 127, 127))
        known = ((mx >= 0) & (mx <= iw - 1) & (my >= 0) & (my <= ih - 1)).astype(np.float32)
        canvas = np.where(known[..., None] > 0, warped, 127).astype(np.uint8)
        return canvas, known

    def enforce_periodic(lat, W, P):
        """average each pair of columns that must be identical (pad <-> opposite core edge)"""
        a = 0.5 * (lat[..., P:2 * P] + lat[..., W + P:W + 2 * P])
        b = 0.5 * (lat[..., :P] + lat[..., W:W + P])
        lat[..., P:2 * P] = a
        lat[..., W + P:W + 2 * P] = a
        lat[..., :P] = b
        lat[..., W:W + P] = b
        return lat

    def decode_periodic(latents, W, P):
        lat = latents.to(vae.dtype)
        lat = (lat / vae.config.scaling_factor) + vae.config.shift_factor
        with torch.no_grad():
            img = vae.decode(lat, return_dict=False)[0]  # (1,3,H,(W+2P)*8)
        img = img[..., P * 8:(P + W) * 8]
        img = (img.float() / 2 + 0.5).clamp(0, 1)
        arr = (img[0].permute(1, 2, 0).cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
        return Image.fromarray(arr)

    torch.cuda.synchronize()
    emit({"event": "ready", "load_seconds": round(time.time() - t0, 1), "vram_gb": round(torch.cuda.memory_allocated() / 2**30, 2)})

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
        if cmd not in ("gen", "refine"):
            continue
        rid = req.get("id")
        try:
            t1 = time.time()
            torch.cuda.reset_peak_memory_stats()
            width = int(req.get("width") or 2048)
            height = int(req.get("height") or width // 2)
            seed = int(req.get("seed") or 0)
            steps = int(req.get("steps") or 9)
            prompt = req.get("raw_prompt") or build_prompt(req["prompt"])
            pe = encode(prompt)
            peak_te = torch.cuda.max_memory_allocated() / 2**30
            torch.cuda.reset_peak_memory_stats()
            dit, fp8 = load_dit()
            t_load = time.time() - t1
            W8, H8 = width // 8, height // 8
            gen = torch.Generator("cuda").manual_seed(seed)

            # starting picture (options.image): its latents are re-injected, noised to the current level, at every step (RePaint-style),
            # everywhere except the cells that must be invented, so the picture stays in front of the player and the rest grows around it
            known = None
            if cmd == "gen" and req.get("image"):
                canvas, kmask = make_canvas(req["image"], width, height, req.get("fov") or 80, req.get("horizon_y") or 0.5)
                pw = PAD * 8
                cpad = np.concatenate([canvas[:, -pw:], canvas, canvas[:, :pw]], axis=1)
                kpad = np.concatenate([kmask[:, -pw:], kmask, kmask[:, :pw]], axis=1)
                xin = torch.from_numpy(cpad).float().div(127.5).sub(1.0).permute(2, 0, 1)[None].to("cuda", vae.dtype)
                with torch.no_grad():
                    z0 = vae.encode(xin).latent_dist.sample(gen)
                z0 = ((z0 - vae.config.shift_factor) * vae.config.scaling_factor).float()
                km = torch.from_numpy(kpad)[None, None].to("cuda")
                km = F.interpolate(km, size=(H8, W8 + 2 * PAD), mode="area")
                km = (km > 0.98).float()                          # only cells fully inside the picture count as known
                km = -F.max_pool2d(-km, 7, 1, 3)                  # and three cells less at the edge: the model blends the join over a wide band
                known = {"z0": z0, "keep": km, "gen_mask": 1.0 - km, "canvas": canvas, "kmask": kmask}
                del xin
                torch.cuda.empty_cache()

            def cb(pipe, i, t, kw):
                lat = enforce_periodic(kw["latents"], W8, PAD)
                if known is not None:
                    sig = float(pipe.scheduler.sigmas[min(i + 1, len(pipe.scheduler.sigmas) - 1)])
                    ref = (1.0 - sig) * known["z0"] + sig * known["eps"]
                    lat = known["gen_mask"] * lat + known["keep"] * ref
                    lat = enforce_periodic(lat, W8, PAD)
                kw["latents"] = lat
                return kw

            def refine(src_img, w, h, strength):
                """img2img at (w x h) from src_img (PIL), same periodic wrap trick; returns padded latents"""
                w8, h8 = w // 8, h // 8
                src = src_img.convert("RGB").resize((w, h), Image.LANCZOS)
                a = np.asarray(src)
                pw = PAD * 8
                a = np.concatenate([a[:, -pw:], a, a[:, :pw]], axis=1)  # wrap-pad the picture itself
                p2 = ZImageImg2ImgPipeline(scheduler=sched, vae=vae, text_encoder=None, tokenizer=tok, transformer=dit)
                p2.set_progress_bar_config(disable=True)

                def cb2(pipe_, i, t, kw):
                    kw["latents"] = enforce_periodic(kw["latents"], w8, PAD)
                    return kw

                out = p2(prompt_embeds=pe, image=Image.fromarray(a), strength=strength, height=h,
                         width=(w8 + 2 * PAD) * 8, num_inference_steps=steps, guidance_scale=0.0, generator=gen,
                         output_type="latent", callback_on_step_end=cb2, callback_on_step_end_tensor_inputs=["latents"]).images
                del p2
                return enforce_periodic(out, w8, PAD)

            hi_img = None
            if cmd == "gen":
                pipe = ZImagePipeline(scheduler=sched, vae=vae, text_encoder=None, tokenizer=tok, transformer=dit)
                pipe.set_progress_bar_config(disable=True)
                core = torch.randn((1, 16, H8, W8), generator=gen, device="cuda", dtype=torch.float32)
                lat0 = torch.cat([core[..., -PAD:], core, core[..., :PAD]], dim=-1)
                if known is not None:
                    known["eps"] = lat0.clone()
                out = pipe(prompt_embeds=pe, height=height, width=(W8 + 2 * PAD) * 8, num_inference_steps=steps,
                           guidance_scale=0.0, generator=gen, latents=lat0, output_type="latent",
                           callback_on_step_end=cb, callback_on_step_end_tensor_inputs=["latents"]).images
                lat = enforce_periodic(out, W8, PAD)
                del pipe
                t_base = time.time() - t1
                img = decode_periodic(lat, W8, PAD)
                if known is not None:  # put the original pixels back (feathered), the VAE round trip would soften them
                    import cv2
                    a = np.asarray(img).astype(np.float32)
                    m = cv2.GaussianBlur(cv2.erode(known["kmask"], np.ones((41, 41), np.uint8)), (0, 0), 18)[..., None]
                    a = a * (1 - m) + known["canvas"].astype(np.float32) * m
                    img = Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8))
                img.save(req["out"])
                del lat
                if req.get("hi_out"):  # second pass: upscale 2x and let the model add detail at the larger size
                    torch.cuda.empty_cache()
                    hl = refine(img, width * 2, height * 2, float(req.get("strength") or 0.4))
                    torch.cuda.empty_cache()
                    hi_img = decode_periodic(hl, W8 * 2, PAD)
                    hi_img.save(req["hi_out"])
                    del hl
            else:  # refine an existing image
                hl = refine(Image.open(req["image"]), width, height, float(req.get("strength") or 0.4))
                img = decode_periodic(hl, W8, PAD)
                img.save(req["out"])
                del hl
                t_base = time.time() - t1
            peak_dit = torch.cuda.max_memory_allocated() / 2**30
            t_gen = time.time() - t1
            del dit
            gc.collect()
            torch.cuda.empty_cache()
            emit({"event": "result", "id": rid, "ok": True, "image": req["out"], "hi_image": req.get("hi_out") if hi_img else None,
                  "prompt_used": prompt, "fp8": fp8,
                  "seconds": round(time.time() - t1, 2), "load_seconds": round(t_load, 2), "base_seconds": round(t_base - t_load, 2),
                  "denoise_seconds": round(t_gen - t_load, 2),
                  "vram_peak_gb": round(max(peak_te, peak_dit), 2), "width": img.width, "height": img.height})
        except Exception as e:
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
