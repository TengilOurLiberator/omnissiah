"""Latency/quality probe of Chatterbox-Turbo with the synthetic refs.  python design_turbo.py NAME..."""
import os, sys, time, json
os.environ.setdefault("HF_HOME", os.path.expanduser("~/voice/hf"))
import torch
import dsp
from chatterbox.tts_turbo import ChatterboxTurboTTS
from design import LINES, CACHE, SR

m = ChatterboxTurboTTS.from_pretrained(device="cuda")
print("vram", round(torch.cuda.memory_allocated() / 1e9, 2), "GB sr", m.sr)
os.makedirs(f"{CACHE}/sweep", exist_ok=True)
for name in sys.argv[1:]:
    m.prepare_conditionals(f"{CACHE}/refs/{name}.wav")
    for temp in (0.6, 0.9):
        for li, line in enumerate(LINES):
            torch.manual_seed(1234)
            t = time.time()
            w = m.generate(line, temperature=temp).squeeze(0).cpu().numpy()
            dt = time.time() - t
            w = dsp.trim(w, m.sr)
            tag = f"turbo_{name}_t{int(temp*10)}_l{li}"
            dsp.save(f"{CACHE}/sweep/{tag}.wav", dsp.normalize(w), m.sr)
            f0, vf = dsp.f0_stats(w, m.sr)
            print(dict(tag=tag, seconds=round(len(w) / m.sr, 2), gen_s=round(dt, 2), f0=round(f0), peak=round(dsp.peak(w), 2), wps=round(len(line.split()) / (len(w) / m.sr), 2), centroid=round(dsp.centroid(w, m.sr))), flush=True)
