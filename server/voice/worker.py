"""Omnissiah voice worker: Chatterbox (original + Turbo) resident on the GPU behind a tiny localhost HTTP API.

  POST /speak   {text, voice='omnissiah', exaggeration?, cfg?, temperature?, seed?, variant?}  -> audio/wav bytes
                headers: X-Seconds (audio length), X-Gen-Ms (synthesis time), X-Voice, X-Variant
  GET  /health  -> {ok, loaded:[...], voices:[...], vram_gb, idle_s, busy, queue}
  POST /warm    load the models of the default voices and run a throw-away line
  POST /unload  free the models now (VRAM back to the bare CUDA context)
  POST /shutdown

One inference at a time (a lock), FIFO by arrival. Models are loaded on first use, unloaded after --idle seconds
without requests (default 900). The process itself is stopped by the Node plugin after a longer idle time.
Voices come from voices.json next to this file (re-read when it changes). Reference clips live in <root>/.cache/voice/refs.
"""
import argparse, io, json, os, sys, threading, time, traceback, gc
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("HF_HOME", os.path.expanduser("~/voice/hf"))
os.environ.setdefault("PYTHONWARNINGS", "ignore")
import warnings
warnings.filterwarnings("ignore")
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dsp  # noqa: E402

SR = 24000
MAX_CHARS = 700
LOG = None


def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(line, flush=True)


class Expired(Exception):
    """the caller gave up (deadline passed) before this request reached the GPU"""


class Engine:
    def __init__(self, root, idle):
        self.root = root
        self.refs_dir = os.path.join(root, ".cache", "voice", "refs")
        self.idle = idle
        self.models = {}          # variant -> model
        self.conds = {}           # (variant, voice, mtime) -> Conditionals
        self.lock = threading.Lock()
        self.last = time.time()
        self.waiting = 0
        self.busy = False
        self._voices = None
        self._voices_mtime = 0
        self.stats = {"requests": 0, "failures": 0}

    # ------------------------------------------------------------------ voices
    def voices(self):
        p = os.path.join(HERE, "voices.json")
        try:
            m = os.path.getmtime(p)
            if self._voices is None or m != self._voices_mtime:
                self._voices = json.load(open(p, encoding="utf-8"))
                self._voices_mtime = m
        except Exception as e:  # keep the previous table if the file is mid-edit
            log("voices.json:", e)
            if self._voices is None:
                self._voices = {}
        return self._voices

    # ------------------------------------------------------------------ models
    def model(self, variant):
        if variant in self.models:
            return self.models[variant]
        import torch
        t = time.time()
        if variant == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            m = ChatterboxTurboTTS.from_pretrained(device="cuda")
        else:
            from chatterbox.tts import ChatterboxTTS
            m = ChatterboxTTS.from_pretrained(device="cuda")
        self.models[variant] = m
        log(f"loaded chatterbox {variant} in {time.time() - t:.1f}s; vram {torch.cuda.memory_allocated() / 1e9:.2f} GB")
        return m

    def unload(self):
        if not self.models:
            return False
        import torch
        self.models.clear()
        self.conds.clear()
        gc.collect()
        torch.cuda.empty_cache()
        log("models unloaded; vram", round(torch.cuda.memory_allocated() / 1e9, 2), "GB")
        return True

    def conditionals(self, m, variant, name, spec):
        ref = os.path.join(self.refs_dir, spec.get("ref", name + ".wav"))
        if not os.path.exists(ref):
            return None  # falls back to the model's built-in voice
        key = (variant, name, os.path.getmtime(ref))
        c = self.conds.get(key)
        if c is None:
            m.prepare_conditionals(ref, exaggeration=float(spec.get("exaggeration", 0.5)))
            c = m.conds
            for k in [k for k in self.conds if k[:2] == key[:2]]:
                del self.conds[k]
            self.conds[key] = c
        return c

    # ------------------------------------------------------------------ synthesis
    def speak(self, req):
        import torch
        text = " ".join(str(req.get("text", "")).split())[:MAX_CHARS]
        if not text:
            raise ValueError("empty text")
        name = req.get("voice") or "omnissiah"
        voices = self.voices()
        spec = dict(voices.get(name) or voices.get("omnissiah") or {})
        variant = req.get("variant") or spec.get("variant", "turbo")
        for k in ("exaggeration", "cfg", "temperature"):
            if req.get(k) is not None:
                spec[k] = float(req[k])
        seed = req.get("seed")
        self.waiting += 1
        with self.lock:
            self.waiting -= 1
            self.busy = True
            try:
                if req.get("expires_ms") and time.time() * 1000 > float(req["expires_ms"]):
                    raise Expired("request expired while queued")
                t0 = time.time()
                m = self.model(variant)
                c = self.conditionals(m, variant, name, spec)
                if c is not None:
                    m.conds = c
                words = max(1, len(text.split()))
                limit = max(3.5, words * 0.9 + 1.5)   # seconds; anything longer is a runaway generation
                best = None
                for attempt in range(3):
                    s = int(seed) if (seed is not None and attempt == 0) else int.from_bytes(os.urandom(3), "little")
                    torch.manual_seed(s)
                    kw = dict(temperature=float(spec.get("temperature", 0.8)))
                    if variant != "turbo":
                        kw.update(exaggeration=float(spec.get("exaggeration", 0.5)), cfg_weight=float(spec.get("cfg", 0.5)))
                    w = m.generate(text, **kw).squeeze(0).detach().cpu().numpy()
                    w = dsp.trim(w, SR)
                    secs = len(w) / SR
                    ok = 0.12 * words < secs <= limit and bool(np.isfinite(w).all())
                    if best is None or (ok and not best[1]):
                        best = (w, ok)
                    if ok:
                        break
                    log(f"runaway/short output ({secs:.1f}s for {words} words), retry {attempt + 1}")
                w = self.post(best[0], spec.get("post") or {})
                self.stats["requests"] += 1
                ms = int((time.time() - t0) * 1000)
                log(f"speak {name}/{variant}: {len(w) / SR:.1f}s audio for {words} words in {ms} ms")
                return w, ms, variant, name
            except Expired:
                self.stats["expired"] = self.stats.get("expired", 0) + 1
                raise
            except Exception:
                self.stats["failures"] += 1
                raise
            finally:
                self.busy = False
                self.last = time.time()

    def post(self, w, p):
        eqk = {k: v for k, v in (p.get("eq") or {}).items()}
        if eqk:
            w = dsp.eq(w, SR, **eqk)
        if p.get("ensemble"):
            w = dsp.ensemble(w, SR, mix=float(p["ensemble"]))
        if p.get("pitch"):
            w = dsp.pitch_shift(w, SR, float(p["pitch"]))
        w = dsp.normalize(w, -3.0)
        if p.get("drive"):
            w = dsp.soft_limit(w, 0.9, float(p["drive"]))
        w = dsp.fade(dsp.normalize(w, float(p.get("peak_db", -2.0))), SR)
        return w

    def warm(self):
        names = [n for n in ("omnissiah",) if n in self.voices()] or ["omnissiah"]
        for n in names:
            try:
                self.speak({"text": "Awake.", "voice": n})
            except Exception as e:
                log("warm failed:", e)

    def idle_check(self):
        if self.models and not self.busy and time.time() - self.last > self.idle:
            with self.lock:
                if time.time() - self.last > self.idle:
                    self.unload()


def wav_bytes(w):
    pcm = (np.clip(w, -1, 1) * 32767).astype("<i2").tobytes()
    n = len(pcm)
    h = b"RIFF" + (36 + n).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + (1).to_bytes(2, "little") + (1).to_bytes(2, "little")
    h += SR.to_bytes(4, "little") + (SR * 2).to_bytes(4, "little") + (2).to_bytes(2, "little") + (16).to_bytes(2, "little") + b"data" + n.to_bytes(4, "little")
    return h + pcm


def make_handler(eng, server_box):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json", extra=None):
            if not isinstance(body, (bytes, bytearray)):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, str(v))
            self.end_headers()
            self.wfile.write(body)

        def _json(self):
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            return json.loads(self.rfile.read(n).decode("utf-8") or "{}")

        def do_GET(self):
            if self.path.split("?")[0] == "/health":
                vram = peak = reserved = None
                try:
                    import torch
                    if eng.models:
                        vram = round(torch.cuda.memory_allocated() / 1e9, 2)
                        peak = round(torch.cuda.max_memory_allocated() / 1e9, 2)
                        reserved = round(torch.cuda.memory_reserved() / 1e9, 2)
                except Exception:
                    pass
                return self._send(200, {"ok": True, "loaded": sorted(eng.models), "voices": sorted(eng.voices()), "vram_gb": vram, "vram_peak_gb": peak, "vram_reserved_gb": reserved,
                                        "idle_s": int(time.time() - eng.last), "busy": eng.busy, "queue": eng.waiting, **eng.stats})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            try:
                req = self._json()
                if path == "/speak":
                    w, ms, variant, name = eng.speak(req)
                    return self._send(200, wav_bytes(w), "audio/wav", {"X-Seconds": round(len(w) / SR, 3), "X-Gen-Ms": ms, "X-Voice": name, "X-Variant": variant})
                if path == "/warm":   # blocks until the default voice has produced a throw-away line
                    t = time.time()
                    eng.warm()
                    return self._send(200, {"ok": True, "loaded": sorted(eng.models), "ms": int((time.time() - t) * 1000)})
                if path == "/unload":
                    with eng.lock:
                        return self._send(200, {"ok": True, "unloaded": eng.unload()})
                if path == "/shutdown":
                    self._send(200, {"ok": True})
                    threading.Thread(target=server_box[0].shutdown, daemon=True).start()
                    return
                self._send(404, {"error": "not found"})
            except Expired as e:
                try:
                    self._send(408, {"error": str(e)})
                except Exception:
                    pass
            except Exception as e:
                log("request failed:", traceback.format_exc())
                try:
                    self._send(500, {"error": str(e)})
                except Exception:
                    pass

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18770)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--root", default="/mnt/d/omnissiah")
    ap.add_argument("--idle", type=int, default=900)
    ap.add_argument("--warm", action="store_true", help="load the default voice at start")
    a = ap.parse_args()
    eng = Engine(a.root, a.idle)
    box = [None]
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(eng, box))
    srv.daemon_threads = True
    box[0] = srv
    log(f"voice worker listening on {a.host}:{a.port} (idle unload {a.idle}s)")

    def reaper():
        while True:
            time.sleep(15)
            try:
                eng.idle_check()
            except Exception as e:
                log("idle check failed:", e)
    threading.Thread(target=reaper, daemon=True).start()
    if a.warm:
        threading.Thread(target=eng.warm, daemon=True).start()
    try:
        srv.serve_forever()
    finally:
        log("voice worker stopped")
        sys.stdout.flush()
        os._exit(0)  # skip interpreter teardown (CUDA threads abort noisily otherwise)


if __name__ == "__main__":
    main()
