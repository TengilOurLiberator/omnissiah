"""Probe of MOSS-SoundEffect v2: window size / step count trade-offs.
Run:  ~/audio/moss/bin/python probe_moss.py            (writes wavs to .cache/audio/probe)
"""
import os, sys, time, json
os.environ["TORCHDYNAMO_DISABLE"] = "1"
os.environ.setdefault("HF_HUB_CACHE", os.path.expanduser("~/audio/hf"))
import torch, soundfile as sf, numpy as np
from moss_soundeffect_v2 import MossSoundEffectPipeline

out = "/mnt/d/omnissiah/.cache/audio/probe"
os.makedirs(out, exist_ok=True)
t0 = time.time()
pipe = MossSoundEffectPipeline.from_pretrained("OpenMOSS-Team/MOSS-SoundEffect-v2.0", torch_dtype=torch.bfloat16, device="cuda")
print("load", round(time.time() - t0, 1), "s; sr", pipe.sample_rate, "vram", round(torch.cuda.memory_allocated() / 1e9, 2), "max_inf", pipe.max_inference_seconds, flush=True)
quiet = lambda it, **k: it
tests = [
    # name, prompt, seconds, window, steps
    ("slash_w30_s50", "A sharp sword slash cutting through flesh, a single wet slicing hit.", 2.0, 30, 50),
    ("slash_w6_s50", "A sharp sword slash cutting through flesh, a single wet slicing hit.", 2.0, 6, 50),
    ("slash_w6_s25", "A sharp sword slash cutting through flesh, a single wet slicing hit.", 2.0, 6, 25),
    ("slash_w4_s50", "A sharp sword slash cutting through flesh, a single wet slicing hit.", 2.0, 4, 50),
    ("step_w6_s50", "A single footstep on grass, soft crunch of a boot on grass.", 1.0, 6, 50),
    ("step_w6_s50b", "Footsteps walking on grass, soft boot crunching on dry grass.", 3.0, 6, 50),
    ("goblin_w6_s50", "A small goblin cackling evilly, a short high-pitched raspy laugh.", 3.0, 6, 50),
    ("explosion_w8_s50", "A single large explosion with a deep boom and rumbling debris.", 4.0, 8, 50),
]
for name, p, sec, win, steps in tests:
    torch.cuda.reset_peak_memory_stats()
    t = time.time()
    a = pipe(prompt=p, seconds=sec, num_inference_steps=steps, cfg_scale=4.0, seed=1, max_inference_seconds=win, progress_bar_cmd=quiet)
    torch.cuda.synchronize()
    dt = time.time() - t
    w = a[0].detach().float().cpu().numpy()
    print(name, "shape", tuple(a.shape), "time", round(dt, 2), "peakvram", round(torch.cuda.max_memory_allocated() / 1e9, 2),
          "peak", round(float(np.abs(w).max()), 3), "rms", round(float(np.sqrt((w ** 2).mean())), 4), flush=True)
    sf.write(f"{out}/{name}.wav", w.T, pipe.sample_rate)
