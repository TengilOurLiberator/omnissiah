#!/usr/bin/env python3
"""GPU speech-recognition worker for Omnissiah (faster-whisper / CTranslate2, Whisper large-v3-turbo).

  GET  /health                          -> {ok, ready, model, device, error}
  POST /transcribe?rate=48000&lang=en   body: raw little-endian int16 mono PCM
                                        -> {text, seconds, language, ms}
  POST /shutdown                        -> exits

Binds 127.0.0.1 only. Started by server/stt.js through server/stt/start_worker.sh.
"""
import argparse, json, math, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import numpy as np

PROMPT = os.environ.get(
    "STT_PROMPT",
    "Omnissiah, conjure, summon, spawn, goblin, orc, skeleton, knight, sword, firebolt, spell, dragon.",
)
MODEL_NAME = os.environ.get("STT_MODEL", "large-v3-turbo")
COMPUTE = os.environ.get("STT_COMPUTE", "float16")
DEFAULT_LANG = os.environ.get("STT_LANG", "en")

S = {"model": None, "ready": False, "error": None, "device": "cuda", "last_use": time.time(), "model_name": MODEL_NAME}
LOCK = threading.Lock()  # one transcription at a time


def log(*a):
    print(time.strftime("%H:%M:%S"), "[stt-worker]", *a, flush=True)


def load_model():
    try:
        from faster_whisper import WhisperModel
        t = time.time()
        root = os.path.join(os.path.expanduser("~"), "stt", "models")
        S["model"] = WhisperModel(MODEL_NAME, device="cuda", compute_type=COMPUTE, download_root=root)
        log(f"loaded {MODEL_NAME} ({COMPUTE}) on cuda in {time.time() - t:.1f}s")
        # warm the kernels with one second of low noise so the first real utterance is fast
        t = time.time()
        rng = np.random.default_rng(1)
        list(S["model"].transcribe((rng.standard_normal(16000) * 0.01).astype(np.float32), language="en", beam_size=5, vad_filter=False)[0])
        log(f"warm-up {time.time() - t:.2f}s")
        S["ready"] = True
    except Exception as e:  # noqa: BLE001
        S["error"] = f"{type(e).__name__}: {e}"
        log("model load failed:", S["error"])


def to_16k(pcm, rate):
    x = pcm.astype(np.float32) / 32768.0
    if rate == 16000:
        return x
    from scipy.signal import resample_poly
    g = math.gcd(int(rate), 16000)
    return resample_poly(x, 16000 // g, int(rate) // g).astype(np.float32)


def transcribe(pcm, rate, lang):
    t0 = time.time()
    audio = to_16k(pcm, rate)
    seconds = len(audio) / 16000.0
    language = None if lang in ("auto", "", None) else lang
    with LOCK:
        segs, info = S["model"].transcribe(
            audio,
            language=language,
            beam_size=5,
            vad_filter=True,
            vad_parameters={"threshold": 0.35, "min_silence_duration_ms": 600, "speech_pad_ms": 300},
            condition_on_previous_text=False,
            initial_prompt=PROMPT,
            no_speech_threshold=0.6,
            temperature=[0.0, 0.2, 0.4],
        )
        text = " ".join(s.text.strip() for s in segs).strip()
    S["last_use"] = time.time()
    return {"text": text, "seconds": round(seconds, 2), "language": info.language, "ms": int((time.time() - t0) * 1000)}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            self._send(200, {"ok": True, "ready": S["ready"], "model": S["model_name"], "device": S["device"], "error": S["error"]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        if u.path == "/shutdown":
            self._send(200, {"ok": True})
            log("shutdown requested")
            threading.Thread(target=lambda: (time.sleep(0.2), os._exit(0)), daemon=True).start()
            return
        if u.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        if not S["ready"]:
            return self._send(503, {"error": S["error"] or "model not ready"})
        q = parse_qs(u.query)
        try:
            rate = int(q.get("rate", ["16000"])[0])
            lang = q.get("lang", [DEFAULT_LANG])[0]
            pcm = np.frombuffer(body[: len(body) // 2 * 2], dtype="<i2")
            if len(pcm) == 0:
                return self._send(200, {"text": "", "seconds": 0, "language": lang, "ms": 0})
            self._send(200, transcribe(pcm, rate, lang))
        except Exception as e:  # noqa: BLE001
            log("transcribe failed:", repr(e))
            self._send(500, {"error": f"{type(e).__name__}: {e}"})


def idle_watch(limit):
    while True:
        time.sleep(30)
        if limit > 0 and time.time() - S["last_use"] > limit:
            log(f"idle for {limit}s: exiting to free the GPU")
            os._exit(0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18790)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--idle", type=int, default=int(os.environ.get("STT_IDLE_S", "7200")))
    a = ap.parse_args()
    threading.Thread(target=load_model, daemon=True).start()
    threading.Thread(target=idle_watch, args=(a.idle,), daemon=True).start()
    srv = ThreadingHTTPServer((a.host, a.port), H)
    log(f"listening on {a.host}:{a.port}")
    srv.serve_forever()
