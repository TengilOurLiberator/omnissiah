"""Builds the synthetic reference clips for the Omnissiah's voices and runs a candidate sweep.
Sources are Kokoro clips (make-refs.mjs) -> pitch/formant lowered + EQ -> Chatterbox clones the TIMBRE. No real person is involved.

  python design.py refs                 # build refs/<name>.wav from refsrc/*.wav
  python design.py sweep NAME [...]     # generate test lines for each (exaggeration, cfg) -> samples + stats.json
"""
import os, sys, json, time
os.environ.setdefault("HF_HOME", os.path.expanduser("~/voice/hf"))
import numpy as np
import dsp

ROOT = "/mnt/d/omnissiah"
CACHE = f"{ROOT}/.cache/voice"
SR = 24000

# name -> (source kokoro voice, semitones, eq kwargs)
REFS = {
    "omnissiah": ("am_onyx", -3.5, dict(low_db=3.5, low_hz=200, pres_db=1.5, hp_hz=50)),
    "oracle": ("bm_george", -2.5, dict(low_db=2.5, low_hz=220, pres_db=2.0, hp_hz=50)),
    "titan": ("bm_lewis", -6.0, dict(low_db=4.0, low_hz=170, pres_db=1.0, hp_hz=45)),
}


def build_refs():
    os.makedirs(f"{CACHE}/refs", exist_ok=True)
    for name, (src, st, eqk) in REFS.items():
        x, _ = dsp.load(f"{CACHE}/refsrc/{src}.wav", SR)
        x = dsp.trim(x, SR)[: SR * 14]
        y = dsp.pitch_shift(x, SR, st)
        y = dsp.eq(y, SR, **eqk)
        y = dsp.fade(dsp.normalize(y, -3), SR)
        dsp.save(f"{CACHE}/refs/{name}.wav", y, SR)
        f0, vf = dsp.f0_stats(y, SR)
        print(f"ref {name}: {len(y)/SR:.1f}s  f0 {f0:.0f} Hz  voiced {vf:.2f}  centroid {dsp.centroid(y, SR):.0f} Hz")


LINES = [
    "I am the Omnissiah.",
    "You ask for fire, and fire you shall have. Stand back, small one.",
    "Before your kind learned to name the stars, I was already counting them, and not one has ever been missing.",
]


def sweep(names):
    import torch
    from chatterbox.tts import ChatterboxTTS
    m = ChatterboxTTS.from_pretrained(device="cuda")
    res = []
    os.makedirs(f"{CACHE}/sweep", exist_ok=True)
    for name in names:
        m.prepare_conditionals(f"{CACHE}/refs/{name}.wav", exaggeration=0.5)
        for exa, cfg in ((0.5, 0.5), (0.7, 0.35), (0.9, 0.3)):
            for li, line in enumerate(LINES):
                torch.manual_seed(1234)
                t = time.time()
                w = m.generate(line, exaggeration=exa, cfg_weight=cfg, temperature=0.75).squeeze(0).numpy()
                dt = time.time() - t
                w = dsp.trim(w, SR)
                tag = f"{name}_e{int(exa*100)}_c{int(cfg*100)}_l{li}"
                dsp.save(f"{CACHE}/sweep/{tag}.wav", w, SR)
                f0, vf = dsp.f0_stats(w, SR)
                r = dict(tag=tag, voice=name, exa=exa, cfg=cfg, line=li, text=line, seconds=round(len(w) / SR, 2), gen_s=round(dt, 2),
                         f0=round(f0), peak=round(dsp.peak(w), 3), centroid=round(dsp.centroid(w, SR)), wps=round(len(line.split()) / (len(w) / SR), 2))
                print(r, flush=True)
                res.append(r)
    json.dump(res, open(f"{CACHE}/sweep/stats.json", "w"), indent=1)


if __name__ == "__main__":
    if sys.argv[1] == "refs":
        build_refs()
    else:
        sweep(sys.argv[2:])
