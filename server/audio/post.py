"""Post-processing for generated game audio (numpy / scipy / pyloudnorm / PyAV only; no system packages).

  analyze(x, sr)                      objective stats used to accept / reject a generation
  process_oneshot(x, sr, ...)         trim silence, fades, optional keep-first-event, RMS normalise, soft ceiling, mono
  process_loop(x, sr, ...)            seamless loop (equal-power crossfade of the tail into the head), LUFS normalise
  process_music(x, sr, ...)           loop (bar aligned when bpm is known) or stinger (trim + fade), -18 LUFS
  encode_ogg(path, x, sr, bitrate)    Ogg/Opus through PyAV's bundled libopus
  loop_seam(x)                        sample jump at the loop point relative to the typical sample-to-sample step

x is float32, shape (n,) mono or (n, channels).
"""
import math
import numpy as np

ONESHOT_RMS_DB = -20.0     # gated RMS target of one-shots
AMBIENCE_LUFS = -24.0      # loop beds (they sit under everything)
MUSIC_LUFS = -18.0         # music loops / stingers
CEILING = 0.89             # -1 dBFS


def db(v):
    return 20.0 * math.log10(max(float(v), 1e-9))


def frame_env_db(mono, sr, hop_ms=10):
    hop = max(1, int(sr * hop_ms / 1000))
    n = len(mono) // hop
    if n == 0:
        return np.array([db(np.sqrt(np.mean(mono ** 2)) if len(mono) else 0)]), hop
    fr = mono[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(fr ** 2, axis=1))
    return 20.0 * np.log10(np.maximum(rms, 1e-9)), hop


def to_mono(x):
    x = np.asarray(x, dtype=np.float32)
    return x if x.ndim == 1 else x.mean(axis=1)


def analyze(x, sr):
    """Objective measurements (all dB values relative to full scale)."""
    x = np.asarray(x, dtype=np.float32)
    m = to_mono(x)
    n = len(m)
    peak = float(np.max(np.abs(x))) if n else 0.0
    env, hop = frame_env_db(m, sr)
    top = float(env.max()) if len(env) else -120.0
    act = env > (top - 40.0)
    active_frac = float(act.mean()) if len(env) else 0.0
    gate = env > (top - 30.0)
    rms_active = db(np.sqrt(np.mean(m ** 2))) if n else -120.0
    if gate.any():
        fr = m[: len(env) * hop].reshape(len(env), hop)[gate]
        rms_active = db(np.sqrt(np.mean(fr ** 2)))
    # longest internal silence (frames more than 45 dB under the loudest frame) between first and last active frame
    quiet = env < (top - 45.0)
    idx = np.nonzero(~quiet)[0]
    lead = tail = max_gap = 0.0
    if len(idx):
        lead = idx[0] * hop / sr
        tail = (len(env) - 1 - idx[-1]) * hop / sr
        run = 0
        for q in quiet[idx[0]: idx[-1] + 1]:
            run = run + 1 if q else 0
            max_gap = max(max_gap, run * hop / sr)
    # spectral centroid / rolloff of the active part (Welch-ish average of a few windows)
    centroid = rolloff = flatness = 0.0
    if n > 512 and gate.any():
        w = 2048 if n >= 2048 else 1024
        win = np.hanning(w).astype(np.float32)
        frames = []
        step = max(w // 2, 1)
        for s in range(0, n - w + 1, step):
            seg = m[s: s + w]
            if db(np.sqrt(np.mean(seg ** 2))) > top - 30.0:
                frames.append(np.abs(np.fft.rfft(seg * win)) ** 2)
            if len(frames) >= 400:
                break
        if frames:
            ps = np.mean(frames, axis=0) + 1e-12
            f = np.fft.rfftfreq(w, 1.0 / sr)
            centroid = float((f * ps).sum() / ps.sum())
            c = np.cumsum(ps) / ps.sum()
            rolloff = float(f[min(np.searchsorted(c, 0.85), len(f) - 1)])
            flatness = float(np.exp(np.mean(np.log(ps))) / np.mean(ps))
    return {
        'duration': round(n / sr, 3), 'peak': round(peak, 4), 'peak_db': round(db(peak), 1),
        'rms_db': round(rms_active, 1), 'active_frac': round(active_frac, 3),
        'lead_s': round(lead, 3), 'tail_s': round(tail, 3), 'max_gap_s': round(max_gap, 3),
        'centroid_hz': round(centroid), 'rolloff85_hz': round(rolloff), 'flatness': round(flatness, 4),
        'clip_frac': round(float(np.mean(np.abs(x) >= 0.999)) if n else 0.0, 5),
        'dc': round(float(np.mean(m)) if n else 0.0, 5),
    }


def _fade(x, n_in, n_out):
    x = x.copy()
    n = len(x)
    n_in = min(n_in, n // 2)
    n_out = min(n_out, n // 2)
    if n_in > 0:
        r = np.linspace(0.0, 1.0, n_in, dtype=np.float32) ** 1.5
        x[:n_in] *= r if x.ndim == 1 else r[:, None]
    if n_out > 0:
        r = np.linspace(1.0, 0.0, n_out, dtype=np.float32) ** 1.5
        x[n - n_out:] *= r if x.ndim == 1 else r[:, None]
    return x


def _soft_ceiling(x, ceiling=CEILING):
    """Transparent below 0.7*ceiling, smooth tanh knee above it, never exceeds the ceiling."""
    knee = 0.7 * ceiling
    a = np.abs(x)
    over = a > knee
    if not over.any():
        return x
    y = x.copy()
    k = ceiling - knee
    y[over] = np.sign(x[over]) * (knee + k * np.tanh((a[over] - knee) / k))
    return y


def remove_dc(x):
    return x - (np.mean(x, axis=0, keepdims=True) if x.ndim > 1 else np.mean(x))


def highpass(x, sr, fc=25.0):
    from scipy.signal import butter, sosfilt
    sos = butter(2, fc / (sr / 2), btype='high', output='sos')
    return sosfilt(sos, x, axis=0).astype(np.float32)


def trim_silence(x, sr, lead_db=-38.0, tail_db=-48.0, pre_ms=4.0, post_ms=30.0):
    m = to_mono(x)
    env, hop = frame_env_db(m, sr, 5)
    top = float(env.max())
    idx = np.nonzero(env > top + lead_db)[0]
    if not len(idx):
        return x
    s = max(0, int(idx[0] * hop - sr * pre_ms / 1000))
    idx2 = np.nonzero(env > top + tail_db)[0]
    e = min(len(m), int((idx2[-1] + 1) * hop + sr * post_ms / 1000))
    return x[s:e]


def keep_first_event(x, sr, gap_s=0.12, drop_db=-30.0):
    """Cut at the end of the first sound event (a step, a shot): the first stretch of >= gap_s that is drop_db under the peak
    after the event has begun. Models sometimes deliver several hits for 'a single hit'."""
    m = to_mono(x)
    env, hop = frame_env_db(m, sr, 5)
    top = float(env.max())
    on = np.nonzero(env > top - 18.0)[0]
    if not len(on):
        return x
    i = on[0]
    need = max(1, int(gap_s * sr / hop))
    quiet = env < top + drop_db
    run = 0
    for j in range(i, len(env)):
        run = run + 1 if quiet[j] else 0
        if run >= need:
            return x[: (j - need + 1 + 2) * hop]
    return x


def process_oneshot(x, sr, mono=True, single=False, rms_db=ONESHOT_RMS_DB, max_seconds=None, fade_out_ms=None):
    x = np.asarray(x, dtype=np.float32)
    if mono:
        x = to_mono(x)
    x = remove_dc(x)
    x = highpass(x, sr, 22.0)
    x = trim_silence(x, sr)
    if single:
        x = keep_first_event(x, sr)
        x = trim_silence(x, sr)
    if max_seconds and len(x) > max_seconds * sr:
        x = x[: int(max_seconds * sr)]
    n = len(x)
    fo = fade_out_ms if fade_out_ms is not None else min(120.0, 0.18 * n / sr * 1000.0)
    x = _fade(x, int(sr * 0.002), int(sr * fo / 1000.0))
    m = to_mono(x)
    env, hop = frame_env_db(m, sr, 10)
    top = float(env.max()) if len(env) else -60
    gate = env > top - 28.0
    if len(env) and gate.any():
        fr = m[: len(env) * hop].reshape(len(env), hop)[gate]
        cur = db(np.sqrt(np.mean(fr ** 2)))
    else:
        cur = db(np.sqrt(np.mean(m ** 2)) if len(m) else 0)
    gain_db = rms_db - cur
    peak = float(np.max(np.abs(x))) or 1e-6
    # never boost so far that the peak would be squashed by more than ~4 dB
    max_gain = CEILING / peak * 1.6
    g = min(10 ** (gain_db / 20.0), max_gain)
    x = _soft_ceiling(x * g)
    return x.astype(np.float32)


def loudness_normalise(x, sr, lufs):
    import pyloudnorm as pyln
    arr = x if x.ndim > 1 else x[:, None]
    meter = pyln.Meter(sr)
    try:
        cur = meter.integrated_loudness(arr)
    except Exception:
        cur = -30.0
    if not np.isfinite(cur) or cur < -70:
        return x
    g = 10 ** ((lufs - cur) / 20.0)
    y = _soft_ceiling((x * g).astype(np.float32))
    return y


def crossfade_loop(x, sr, xf_s, length=None):
    """Seamless loop: the audio after the loop end is faded into the loop start (equal power), so the last sample is
    followed by the real continuation of the signal when the loop wraps. Returns (loop, xf_samples)."""
    n = len(x)
    xf = int(sr * xf_s)
    xf = max(64, min(xf, n // 3))
    L = (n - xf) if length is None else min(int(length), n - xf)
    t = np.linspace(0.0, math.pi / 2, xf, dtype=np.float32)
    fin, fout = np.sin(t), np.cos(t)
    if x.ndim > 1:
        fin, fout = fin[:, None], fout[:, None]
    y = x[:L].copy()
    y[:xf] = x[:xf] * fin + x[L: L + xf] * fout
    return y, xf


def loop_seam(x):
    """|x[0] - x[-1]| relative to the RMS of the sample-to-sample step (1 = as smooth as the signal itself)."""
    m = to_mono(x)
    step = np.sqrt(np.mean(np.diff(m) ** 2)) + 1e-9
    return float(abs(m[0] - m[-1]) / step)


def lowpass(x, sr, fc):
    from scipy.signal import butter, sosfilt
    sos = butter(4, fc / (sr / 2), btype='low', output='sos')
    return sosfilt(sos, x, axis=0).astype(np.float32)


def process_loop(x, sr, xf_s=2.0, lufs=AMBIENCE_LUFS, stereo=True, trim_head_s=0.15, lp=None):
    x = np.asarray(x, dtype=np.float32)
    if x.ndim == 1 and stereo:
        x = np.stack([x, x], axis=1)
    if not stereo and x.ndim > 1:
        x = x.mean(axis=1)
    x = remove_dc(x)
    x = highpass(x, sr, 25.0)
    if lp:
        x = lowpass(x, sr, lp)
    if trim_head_s:
        x = x[int(sr * trim_head_s):]
    y, xf = crossfade_loop(x, sr, xf_s)
    y = loudness_normalise(y, sr, lufs)
    return y.astype(np.float32)


def process_music(x, sr, loop=True, bpm=None, bars=None, xf_s=2.0, seconds=None, lufs=MUSIC_LUFS, fade_in_ms=15, fade_out_s=None):
    """Music: loop=True -> bar-aligned seamless loop; loop=False -> stinger trimmed to `seconds` with a natural fade."""
    x = np.asarray(x, dtype=np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    x = remove_dc(x)
    x = highpass(x, sr, 25.0)
    if loop:
        n = len(x)
        length = None
        if bpm and bpm > 40:
            bar = sr * 4 * 60.0 / bpm
            xf = int(sr * xf_s)
            avail = n - max(64, min(xf, n // 3))
            k = int(avail // bar)
            if bars:
                k = min(k, int(bars))
            if k >= 2:
                length = int(round(k * bar))
        y, xf = crossfade_loop(x, sr, xf_s, length)
    else:
        y = x
        if seconds and len(y) > seconds * sr:
            y = y[: int(seconds * sr)]
        y = trim_silence(y, sr, lead_db=-50.0, tail_db=-55.0, pre_ms=2.0, post_ms=60.0)
        fo = fade_out_s if fade_out_s is not None else min(1.5, 0.25 * len(y) / sr)
        y = _fade(y, int(sr * fade_in_ms / 1000.0), int(sr * fo))
    y = loudness_normalise(y, sr, lufs) if len(y) > sr * 0.5 else y
    return y.astype(np.float32)


def encode_ogg(path, x, sr, bitrate=64000):
    """Ogg/Opus via PyAV. x float32 (n,) or (n, ch) at sr (48000 recommended). Returns the byte size."""
    import av
    x = np.asarray(x, dtype=np.float32)
    ch = 1 if x.ndim == 1 else x.shape[1]
    pcm = np.clip(x, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16)
    layout = 'mono' if ch == 1 else 'stereo'
    container = av.open(path, 'w', format='ogg')
    stream = container.add_stream('libopus', rate=sr)
    stream.bit_rate = int(bitrate)
    stream.layout = layout
    frame_size = 960 if sr == 48000 else int(sr * 0.02)
    n = len(pcm)
    pad = (-n) % frame_size
    if pad:
        pcm = np.concatenate([pcm, np.zeros((pad,) + pcm.shape[1:], dtype=np.int16)], axis=0)
    for s in range(0, len(pcm), frame_size):
        chunk = pcm[s: s + frame_size]
        arr = np.ascontiguousarray(chunk).reshape(1, -1)  # packed (interleaved) s16
        frame = av.AudioFrame.from_ndarray(arr, format='s16', layout=layout)
        frame.sample_rate = sr
        frame.pts = s
        for pkt in stream.encode(frame):
            container.mux(pkt)
    for pkt in stream.encode(None):
        container.mux(pkt)
    container.close()
    import os
    return os.path.getsize(path)
