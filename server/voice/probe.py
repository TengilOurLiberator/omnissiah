"""Quick check: which chatterbox variants import, download, and how fast they run. python probe.py"""
import os, sys, time, json
os.environ.setdefault("HF_HOME", os.path.expanduser("~/voice/hf"))
import torch, torchaudio as ta
import chatterbox, pkgutil
print("chatterbox modules:", [m.name for m in pkgutil.iter_modules(chatterbox.__path__)])
OUT = "/mnt/d/omnissiah/.cache/voice/probe"
os.makedirs(OUT, exist_ok=True)
which = sys.argv[1] if len(sys.argv) > 1 else "orig"
text = "I am the Omnissiah. I have watched this field since before your kind learned to speak."
t = time.time()
if which == "orig":
    from chatterbox.tts import ChatterboxTTS
    m = ChatterboxTTS.from_pretrained(device="cuda")
else:
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    m = ChatterboxTurboTTS.from_pretrained(device="cuda")
print(which, "load", round(time.time() - t, 1), "s; sr", m.sr, "vram", round(torch.cuda.memory_allocated() / 1e9, 2), "GB")
import inspect
print(inspect.signature(m.generate))
for i in range(3):
    t = time.time()
    if which == "orig":
        w = m.generate(text, exaggeration=0.6, cfg_weight=0.4)
    else:
        w = m.generate(text, audio_prompt_path=OUT + "/ref.wav") if os.path.exists(OUT + "/ref.wav") else None
        if w is None:
            break
    torch.cuda.synchronize()
    dt = time.time() - t
    print(which, "run", i, round(dt, 2), "s for", round(w.shape[-1] / m.sr, 2), "s audio; peak vram", round(torch.cuda.max_memory_allocated() / 1e9, 2), "GB")
    ta.save(f"{OUT}/{which}_{i}.wav", w.cpu(), m.sr)
