"""Small numpy/scipy DSP helpers shared by the voice worker and the design scripts (no sox/ffmpeg needed)."""
import numpy as np
from scipy import signal


def load(path, sr=None):
    import soundfile as sf
    x, r = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr and r != sr:
        import librosa
        x = librosa.resample(x, orig_sr=r, target_sr=sr)
        r = sr
    return x.astype(np.float32), r


def save(path, x, sr):
    import soundfile as sf
    sf.write(path, np.clip(x, -1, 1), sr, subtype="PCM_16")


def peak(x):
    return float(np.max(np.abs(x))) if len(x) else 0.0


def rms_db(x):
    return 20 * np.log10(max(1e-9, float(np.sqrt(np.mean(np.square(x))))))


def normalize(x, peak_db=-1.5):
    p = peak(x)
    return x if p < 1e-6 else (x * (10 ** (peak_db / 20) / p)).astype(np.float32)


def trim(x, sr, thresh_db=-45, pad=0.06):
    """Strip leading/trailing near-silence (keeps `pad` seconds)."""
    if len(x) == 0:
        return x
    env = np.abs(x)
    k = max(1, int(sr * 0.01))
    env = np.convolve(env, np.ones(k) / k, mode="same")
    ok = np.where(env > 10 ** (thresh_db / 20) * max(1e-6, env.max()))[0]
    if len(ok) == 0:
        return x
    a = max(0, ok[0] - int(pad * sr))
    b = min(len(x), ok[-1] + int(pad * sr))
    return x[a:b]


def fade(x, sr, ms_in=8, ms_out=40):
    x = x.copy()
    a, b = int(sr * ms_in / 1000), int(sr * ms_out / 1000)
    if a and len(x) > a:
        x[:a] *= np.linspace(0, 1, a)
    if b and len(x) > b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def _shelf(kind, f0, gain_db, sr, q=0.707):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    sq = 2 * np.sqrt(A) * alpha
    if kind == "low":
        b0 = A * ((A + 1) - (A - 1) * cw + sq)
        b1 = 2 * A * ((A - 1) - (A + 1) * cw)
        b2 = A * ((A + 1) - (A - 1) * cw - sq)
        a0 = (A + 1) + (A - 1) * cw + sq
        a1 = -2 * ((A - 1) + (A + 1) * cw)
        a2 = (A + 1) + (A - 1) * cw - sq
    else:
        b0 = A * ((A + 1) + (A - 1) * cw + sq)
        b1 = -2 * A * ((A - 1) + (A + 1) * cw)
        b2 = A * ((A + 1) + (A - 1) * cw - sq)
        a0 = (A + 1) - (A - 1) * cw + sq
        a1 = 2 * ((A - 1) - (A + 1) * cw)
        a2 = (A + 1) - (A - 1) * cw - sq
    return np.array([b0, b1, b2]) / a0, np.array([1, a1 / a0, a2 / a0])


def _peak(f0, gain_db, q, sr):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    alpha = np.sin(w0) / (2 * q)
    b = np.array([1 + alpha * A, -2 * np.cos(w0), 1 - alpha * A])
    a = np.array([1 + alpha / A, -2 * np.cos(w0), 1 - alpha / A])
    return b / a[0], a / a[0]


def eq(x, sr, low_db=0.0, low_hz=180, mid_db=0.0, mid_hz=300, mid_q=0.9, pres_db=0.0, pres_hz=2800, high_db=0.0, high_hz=7000, hp_hz=0):
    y = x.astype(np.float64)
    if hp_hz:
        sos = signal.butter(2, hp_hz, "highpass", fs=sr, output="sos")
        y = signal.sosfilt(sos, y)
    for kind, f, g, q in (("low", low_hz, low_db, 0.707), ("high", high_hz, high_db, 0.707)):
        if abs(g) > 0.01:
            b, a = _shelf(kind, f, g, sr, q)
            y = signal.lfilter(b, a, y)
    for f, g, q in ((mid_hz, mid_db, mid_q), (pres_hz, pres_db, 0.9)):
        if abs(g) > 0.01:
            b, a = _peak(f, g, q, sr)
            y = signal.lfilter(b, a, y)
    return y.astype(np.float32)


def soft_limit(x, ceiling=0.93, drive=1.0):
    """tanh-style soft clip so peaks never exceed `ceiling` (no hard clipping)."""
    y = np.tanh(x * drive / ceiling) * ceiling
    return (y / np.tanh(drive / ceiling) if drive > 1 else y).astype(np.float32)


def pitch_shift(x, sr, semitones):
    import librosa
    if abs(semitones) < 0.01:
        return x
    return librosa.effects.pitch_shift(x.astype(np.float32), sr=sr, n_steps=semitones, res_type="soxr_hq").astype(np.float32)


def ensemble(x, sr, cents=(-14, 11), delays_ms=(11, 19), mix=0.22):
    """Two faintly detuned, delayed copies under the voice: a 'more than one of him' effect."""
    out = x.copy()
    for c, d in zip(cents, delays_ms):
        y = pitch_shift(x, sr, c / 100.0)
        n = int(sr * d / 1000)
        y = np.concatenate([np.zeros(n, np.float32), y])[: len(x)]
        out[: len(y)] += mix * y
    return out


def f0_stats(x, sr):
    """median fundamental frequency (Hz) of voiced frames, and fraction voiced"""
    import librosa
    f0, voiced, _ = librosa.pyin(x, fmin=50, fmax=400, sr=sr, frame_length=2048)
    v = f0[~np.isnan(f0)]
    return (float(np.median(v)) if len(v) else 0.0, float(len(v)) / max(1, len(f0)))


def centroid(x, sr):
    import librosa
    return float(np.mean(librosa.feature.spectral_centroid(y=x, sr=sr)))
