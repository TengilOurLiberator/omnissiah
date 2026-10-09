"""Prints median f0 / spectral centroid / peak / loudness for every wav in the given directories.  python analyze.py DIR..."""
import sys, glob, os
import numpy as np
import dsp

for d in sys.argv[1:]:
    f0s, cents, rms = [], [], []
    files = sorted(glob.glob(os.path.join(d, "*.wav")))
    for f in files:
        x, sr = dsp.load(f)
        if len(x) / sr < 1.2:
            continue
        f0, vf = dsp.f0_stats(x, sr)
        if f0:
            f0s.append(f0)
        cents.append(dsp.centroid(x, sr))
        rms.append(dsp.rms_db(x))
    print(f"{os.path.basename(d.rstrip('/'))}: n={len(files)} median f0 {np.median(f0s):.0f} Hz (range {min(f0s):.0f}-{max(f0s):.0f}), centroid {np.median(cents):.0f} Hz, rms {np.median(rms):.1f} dBFS")
