"""Self-test of post.py on the probe wavs: python test_post.py [dir]   (run with ~/audio/moss/bin/python)"""
import os, sys, glob, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, soundfile as sf, av
import post

d = sys.argv[1] if len(sys.argv) > 1 else "/mnt/d/omnissiah/.cache/audio/probe"
for f in sorted(glob.glob(d + "/*.wav")):
    x, sr = sf.read(f, dtype="float32")
    a = post.analyze(x, sr)
    single = "step" in f
    y = post.process_oneshot(x, sr, single=single)
    b = post.analyze(y, sr)
    out = f.replace(".wav", ".ogg")
    size = post.encode_ogg(out, y, sr, 48000)
    c = av.open(out)
    dec = []
    for fr in c.decode(audio=0):
        dec.append(fr.to_ndarray())
    c.close()
    dec = np.concatenate(dec, axis=1)
    print(os.path.basename(f), "raw", {k: a[k] for k in ("duration", "peak_db", "rms_db", "centroid_hz", "active_frac", "max_gap_s")})
    print("    ->", {k: b[k] for k in ("duration", "peak_db", "rms_db", "lead_s", "tail_s")}, "ogg", size, "B", "decoded", dec.shape, dec.dtype)
