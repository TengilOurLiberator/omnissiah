"""Probe of ACE-Step 1.5 turbo (DiT only, no language model). Run with ~/audio/ace/bin/python.
Downloads the main model on first use into ~/audio/src/ACE-Step-1.5/checkpoints.
"""
import os, sys, time
SRC = os.path.expanduser("~/audio/src/ACE-Step-1.5")
sys.path.insert(0, SRC)
os.chdir(SRC)
os.environ.setdefault('HF_HOME', os.path.expanduser('~/audio/hfhome'))
os.environ.setdefault('HF_MODULES_CACHE', os.path.expanduser('~/audio/hfhome/modules'))
import torch, numpy as np, soundfile as sf
t0 = time.time()
from acestep.model_downloader import ensure_main_model, ensure_dit_model
print("download main:", ensure_main_model(), flush=True)
print("download turbo:", ensure_dit_model("acestep-v15-turbo"), flush=True)
print("download took", round(time.time() - t0, 1), flush=True)
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

t0 = time.time()
dit = AceStepHandler()
msg = dit.initialize_service(project_root=SRC, config_path="acestep-v15-turbo", device="cuda")
print("init", msg, round(time.time() - t0, 1), "s; vram", round(torch.cuda.memory_allocated() / 1e9, 2), flush=True)
llm = LLMHandler()
out = "/mnt/d/omnissiah/.cache/audio/probe"
os.makedirs(out, exist_ok=True)
tests = [
    ("battle", "epic orchestral battle music, driving percussion, taiko drums, brass stabs, urgent strings, heroic fantasy, instrumental", 120, 30),
    ("calm", "calm peaceful fantasy exploration music, soft acoustic guitar, flute, warm strings, gentle, instrumental", 80, 30),
]
for name, cap, bpm, dur in tests:
    torch.cuda.reset_peak_memory_stats()
    t = time.time()
    params = GenerationParams(caption=cap, lyrics="[Instrumental]", instrumental=True, bpm=bpm, duration=dur, inference_steps=8,
                              shift=3.0, thinking=False, seed=7, use_cot_metas=False, use_cot_caption=False, use_cot_language=False)
    cfg = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[7], audio_format="wav")
    res = generate_music(dit, llm, params, cfg, save_dir=out)
    dt = time.time() - t
    print(name, "success", res.success, res.error, "time", round(dt, 1), "peakvram", round(torch.cuda.max_memory_allocated() / 1e9, 2), flush=True)
    for a in res.audios:
        w = a["tensor"].numpy()
        print("  ", a["path"], w.shape, a["sample_rate"], "peak", round(float(np.abs(w).max()), 3), "rms", round(float(np.sqrt((w ** 2).mean())), 4), flush=True)
