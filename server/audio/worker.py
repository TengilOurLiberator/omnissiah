#!/usr/bin/env python3
"""Omnissiah audio worker: a tiny localhost HTTP service (stdlib + numpy) that turns text into game-ready audio.
Runs inside WSL (use start_worker.sh). Two long-lived runner subprocesses, loaded on demand and unloaded when idle:

  sfx_runner.py    (~/audio/moss, MOSS-SoundEffect v2.0)   text -> sound effect / ambience bed (mono, 48 kHz)
  music_runner.py  (~/audio/ace,  ACE-Step 1.5 turbo)      text -> music (stereo, 48 kHz)

One job at a time, FIFO. Every output is post-processed (post.py) and encoded to Ogg/Opus, then checked objectively;
a failed check regenerates with another seed (max 3 attempts, the best attempt is kept with `warnings`).

  POST /sfx   {prompt, seconds=2, seed?, loop=false, single=false, expect?:{centroid:[lo,hi], min_s, max_gap}, bitrate?}
  POST /music {prompt, seconds=60, seed?, loop=true, bpm?, bitrate?}
  GET  /jobs/<id>  -> {state: queued|generating|processing|done|error, progress, message, file_path, stats, error}
  GET  /health     POST /unload     POST /shutdown
"""
import argparse, json, os, queue, shutil, signal, subprocess, sys, threading, time, traceback, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
HOME = os.path.expanduser("~")
MOSS_PY = os.environ.get("AUDIO_SFX_PY", os.path.join(HOME, "audio", "moss", "bin", "python"))
ACE_PY = os.environ.get("AUDIO_MUSIC_PY", os.path.join(HOME, "audio", "ace", "bin", "python"))
SR = 48000
MAX_ATTEMPTS = 3


class Log:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = open(path, "a", buffering=1, encoding="utf-8")
        self.lock = threading.Lock()

    def __call__(self, *a):
        with self.lock:
            self.f.write(time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


class Runner:
    """A JSON-lines subprocess (same pattern as gen3d). request() blocks for the result and kills the runner on crash/timeout."""

    def __init__(self, name, argv, env, logdir, log, ready_timeout=420):
        self.name, self.argv, self.env, self.logdir, self.log = name, argv, env, logdir, log
        self.ready_timeout = ready_timeout
        self.proc = None
        self.events = queue.Queue()
        self.info = {}

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self):
        if self.alive():
            return
        self.events = queue.Queue()
        errlog = open(os.path.join(self.logdir, f"{self.name}.log"), "a", buffering=1)
        errlog.write(f"\n===== {time.ctime()} start {' '.join(self.argv)}\n")
        self.log(f"[{self.name}] starting")
        self.proc = subprocess.Popen(self.argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errlog,
                                     env=self.env, text=True, bufsize=1, start_new_session=True)
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
        t0 = time.time()
        while True:
            ev = self._next(1.0)
            if ev is None:
                if not self.alive():
                    raise RuntimeError(f"{self.name} runner died while starting")
                if time.time() - t0 > self.ready_timeout:
                    self.kill()
                    raise RuntimeError(f"{self.name} runner did not become ready in {self.ready_timeout}s")
                continue
            if ev.get("event") == "ready":
                self.info = ev
                self.log(f"[{self.name}] ready in {time.time() - t0:.1f}s {ev}")
                return
            if ev.get("event") in ("fatal", "eof"):
                self.kill()
                raise RuntimeError(f"{self.name} runner failed to start: {ev.get('error', 'exited')}")

    def _reader(self, proc):
        try:
            for line in proc.stdout:
                line = line.strip()
                if line:
                    try:
                        self.events.put(json.loads(line))
                    except Exception:
                        pass
        finally:
            self.events.put({"event": "eof"})

    def _next(self, timeout):
        try:
            return self.events.get(timeout=timeout)
        except queue.Empty:
            return None

    def request(self, req, timeout):
        self.start()
        while True:
            try:
                self.events.get_nowait()
            except queue.Empty:
                break
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        t0 = time.time()
        while True:
            ev = self._next(1.0)
            if ev is None:
                if time.time() - t0 > timeout:
                    self.kill()
                    raise TimeoutError(f"{self.name} timed out after {timeout:.0f}s")
                continue
            if ev.get("event") in ("eof", "fatal"):
                self.kill()
                raise RuntimeError(f"{self.name} runner crashed")
            if ev.get("event") == "result" and ev.get("id") == req.get("id"):
                return ev

    def kill(self):
        p, self.proc = self.proc, None
        if p is None:
            return
        self.log(f"[{self.name}] stopping")
        try:
            if p.poll() is None:
                try:
                    p.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
                    p.stdin.flush()
                    p.wait(timeout=5)
                except Exception:
                    pass
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGKILL)
        except Exception:
            pass
        try:
            p.wait(timeout=5)
        except Exception:
            pass


def clean_prompt(s, limit=400):
    return " ".join(str(s or "").split())[:limit]


class Worker:
    def __init__(self, root, idle, job_timeout):
        self.root = root
        self.logdir = os.path.join(root, ".cache", "audio")
        self.jobdir = os.path.join(self.logdir, "jobs")
        os.makedirs(self.jobdir, exist_ok=True)
        now = time.time()
        for d in os.listdir(self.jobdir):  # stale intermediates (> 6 h)
            p = os.path.join(self.jobdir, d)
            try:
                if now - os.path.getmtime(p) > 6 * 3600:
                    shutil.rmtree(p, ignore_errors=True)
            except Exception:
                pass
        self.log = Log(os.path.join(self.logdir, "worker.log"))
        self.idle, self.job_timeout = idle, job_timeout
        self.jobs, self.order = {}, []
        self.q = queue.Queue()
        self.lock = threading.Lock()
        self.current = None
        self.last_activity = time.time()
        self.started = time.time()
        self.stop = threading.Event()
        self.timings = {"sfx_warm": [], "music_warm": [], "sfx_cold": None, "music_cold": None}
        base = dict(os.environ)
        sfx_env = dict(base, HF_HUB_CACHE=os.path.join(HOME, "audio", "hf"), TORCHDYNAMO_DISABLE="1", PYTHONUNBUFFERED="1")
        ace_env = dict(base, PYTHONUNBUFFERED="1")
        self.sfx = Runner("sfx", [MOSS_PY, "-u", os.path.join(HERE, "sfx_runner.py")], sfx_env, self.logdir, self.log)
        self.music = Runner("music", [ACE_PY, "-u", os.path.join(HERE, "music_runner.py")], ace_env, self.logdir, self.log)
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._idle_loop, daemon=True).start()

    # ---------------------------------------------------------------- API
    def submit(self, kind, p):
        job = {"id": uuid.uuid4().hex[:12], "kind": kind, "p": p, "state": "queued", "message": "Waiting in line",
               "created": time.time(), "stage_t0": None, "file_path": None, "stats": None, "error": None}
        with self.lock:
            self.jobs[job["id"]] = job
            self.order.append(job["id"])
            while len(self.order) > 400:
                self.jobs.pop(self.order.pop(0), None)
        self.q.put(job["id"])
        self.log(f"job {job['id']} queued: {kind} {p.get('seconds')}s {p.get('prompt')!r}")
        return job

    def view(self, jid):
        with self.lock:
            j = self.jobs.get(jid)
            if not j:
                return None
            v = {k: j[k] for k in ("id", "kind", "state", "message", "file_path", "stats", "error")}
            v["progress"] = self._progress(j)
            if j["state"] == "queued":
                v["queue_position"] = sum(1 for i in self.order if self.jobs[i]["state"] == "queued" and self.jobs[i]["created"] <= j["created"])
            return v

    def _progress(self, j):
        s = j["state"]
        if s == "done":
            return 1.0
        if s in ("queued", "error"):
            return 0.0
        el = time.time() - (j["stage_t0"] or time.time())
        exp = 12.0 if j["kind"] == "sfx" else 20.0
        if s == "processing":
            return 0.95
        return round(0.05 + 0.85 * min(el / exp, 0.97), 3)

    def health(self):
        with self.lock:
            queued = sum(1 for i in self.order if self.jobs[i]["state"] == "queued")
        return {"ok": True, "uptime": round(time.time() - self.started), "current": self.current, "queued": queued,
                "sfx_loaded": self.sfx.alive(), "music_loaded": self.music.alive(),
                "sfx_vram_gb": self.sfx.info.get("vram_gb") if self.sfx.alive() else None,
                "music_vram_gb": self.music.info.get("vram_gb") if self.music.alive() else None,
                "timings": self.timings, "idle_seconds": round(time.time() - self.last_activity), "idle_unload_after": self.idle}

    def unload(self):
        if self.current:
            return False
        self.sfx.kill()
        self.music.kill()
        return True

    # ---------------------------------------------------------------- job loop
    def _set(self, j, state, message):
        with self.lock:
            j["state"], j["message"], j["stage_t0"] = state, message, time.time()

    def _loop(self):
        while not self.stop.is_set():
            try:
                jid = self.q.get(timeout=1.0)
            except queue.Empty:
                continue
            j = self.jobs.get(jid)
            if not j:
                continue
            self.current = jid
            self.last_activity = time.time()
            try:
                try:
                    self._run(j)
                except (RuntimeError, TimeoutError) as e:
                    self.log(f"job {jid} failed ({e}); retrying once on fresh runners")
                    self._run(j)
            except Exception as e:
                self.log(f"job {jid} error: {e}\n{traceback.format_exc()}")
                with self.lock:
                    j["state"], j["error"], j["message"] = "error", str(e), str(e)
            finally:
                self.current = None
                self.last_activity = time.time()

    # ---- checks -------------------------------------------------------------------------------
    def _problems_sfx(self, raw, fin, p):
        pr = []
        ex = p.get("expect") or {}
        if raw["peak_db"] < -38:
            pr.append(f"silent output (peak {raw['peak_db']} dB)")
        if p.get("loop"):
            if raw["active_frac"] < 0.8:
                pr.append(f"loop bed has gaps (active {raw['active_frac']})")
        else:
            if fin["duration"] < max(0.08, ex.get("min_s", 0.0)):
                pr.append(f"too short after trim ({fin['duration']} s)")
            if fin["duration"] > p["seconds"] * 1.02 + 0.05:
                pr.append("longer than requested")
            if raw["max_gap_s"] > ex.get("max_gap", 0.7) and not p.get("single"):
                pr.append(f"long silence inside ({raw['max_gap_s']} s)")
        c = ex.get("centroid")
        if c and fin["centroid_hz"] and not (c[0] <= fin["centroid_hz"] <= c[1]):
            pr.append(f"spectral centroid {fin['centroid_hz']} Hz outside {c}")
        if fin["clip_frac"] > 0.002:
            pr.append("clipping")
        return pr

    def _run(self, j):
        t_start = time.time()
        d = os.path.join(self.jobdir, j["id"])
        os.makedirs(d, exist_ok=True)
        if j["kind"] == "sfx":
            self._run_sfx(j, d, t_start)
        else:
            self._run_music(j, d, t_start)

    def _gen(self, runner, req, label, cold_key, warm_key):
        cold = not runner.alive()
        if cold:
            self.log(f"[{runner.name}] cold start for job")
        r = runner.request(req, timeout=self.job_timeout)
        if not r.get("ok"):
            raise ValueError(r.get("error") or f"{label} failed")
        if cold and self.timings.get(cold_key) is None:
            self.timings[cold_key] = {"load_s": runner.info.get("load_seconds"), "first_job_s": r.get("seconds"), "vram_loaded_gb": runner.info.get("vram_gb"), "vram_peak_gb": r.get("vram_peak_gb")}
        elif not cold:
            self.timings[warm_key] = (self.timings[warm_key] + [r.get("seconds")])[-30:]
        return r

    def _bank(self):
        if getattr(self, "_bank_cache", None) is None:
            try:
                with open(os.path.join(HERE, "clap_bank.json"), encoding="utf-8") as f:
                    self._bank_cache = list(json.load(f))
            except Exception:
                self._bank_cache = []
        return self._bank_cache

    def _score(self, runner, wav, prompt):
        """CLAP similarity of a candidate to its prompt (None when scoring is unavailable)."""
        try:
            runner.start()
            if runner.info.get("_bank_pid") != runner.proc.pid:
                bank = self._bank()
                if bank:
                    runner.request({"cmd": "bank", "id": f"bank-{runner.proc.pid}", "prompts": bank}, timeout=180)
                runner.info["_bank_pid"] = runner.proc.pid
            r = runner.request({"cmd": "score", "id": uuid.uuid4().hex[:8], "wav": wav, "prompt": prompt}, timeout=120)
            return {"sim": r["sim"], "rank": r.get("rank"), "of": r.get("of")} if r.get("ok") else None
        except Exception as e:  # scoring must never fail a job
            self.log(f"score failed: {e}")
            return None

    def _run_sfx(self, j, d, t_start):
        import numpy as np, soundfile as sf, post
        p = j["p"]
        sec = float(p["seconds"])
        ncand = max(1, min(5, int(p.get("candidates") or 1)))
        want_score = ncand > 1 or bool(p.get("score"))
        cands = []
        gen_total = 0.0
        tries = 0
        # the model returns silence far more often for requests under ~1.5 s: ask for at least 2 s and crop/trim afterwards
        gen_sec = sec if p.get("loop") else max(sec, 2.0)
        while tries < ncand + 3:
            seed = (int(p["seed"]) + tries * 7919) & 0x7fffffff
            self._set(j, "generating", "Listening for the sound" if tries == 0 else f"Trying another take ({tries + 1})")
            ch = []
            for c in range(2 if p.get("loop") else 1):
                wav = os.path.join(d, f"raw_{tries}_{c}.wav")
                r = self._gen(self.sfx, {"cmd": "gen", "id": f"{j['id']}-{tries}-{c}", "prompt": p["prompt"], "seconds": gen_sec,
                                         "seed": seed + c * 104729, "window": None if tries == 0 else min(30, max(6, int(gen_sec + 3.99)) + 2 * (tries % 3)), "cfg": (4.0, 3.0, 5.0)[tries % 3], "steps": 50, "out": wav}, "sound generation", "sfx_cold", "sfx_warm")
                gen_total += r.get("seconds", 0)
                ch.append(sf.read(wav, dtype="float32")[0])
            self._set(j, "processing", "Mastering the sound")
            n = min(len(c) for c in ch)
            raw = np.stack([c[:n] for c in ch], axis=1) if len(ch) == 2 else ch[0]
            a = post.analyze(raw, SR)
            if p.get("loop"):
                xf = min(2.0, max(0.5, sec * 0.12))
                y = post.process_loop(raw, SR, xf_s=xf, lufs=post.AMBIENCE_LUFS, stereo=True, lp=10000 if a['centroid_hz'] > 8000 else None)  # hissy beds: no content above 10 kHz
                br = int(p.get("bitrate") or 80000)
            else:
                y = post.process_oneshot(raw, SR, mono=True, single=bool(p.get("single")), max_seconds=sec)
                br = int(p.get("bitrate") or 48000)
            b = post.analyze(y, SR)
            seam = post.loop_seam(y) if p.get("loop") else None
            pr = self._problems_sfx(a, b, p)
            if seam is not None and seam > 4.0:
                pr.append(f"loop seam jump x{seam:.1f}")
            clap = None
            if want_score and not pr:
                sw = os.path.join(d, f"cand_{tries}.wav")
                sf.write(sw, y, SR, subtype="FLOAT")
                clap = self._score(self.sfx, sw, p["prompt"])
                if clap and clap["sim"] < 0.05:
                    pr.append(f"poor text match (CLAP {clap['sim']})")
            cands.append({"y": y, "br": br, "raw": a, "fin": b, "seam": seam, "problems": pr, "seed": seed, "clap": clap})
            tries += 1
            if len([c for c in cands if not c["problems"]]) >= ncand:
                break
            self.log(f"job {j['id']} take {tries} rejected: {pr}")
        best = self._pick(cands)
        if best['raw']['peak_db'] < -50:
            raise ValueError('the model returned silence for this prompt (' + str(len(cands)) + ' takes)')
        self._finish(j, d, best, gen_total, t_start, SR, kind="loop" if p.get("loop") else "oneshot", takes=len(cands))

    @staticmethod
    def _pick(cands):
        pool = [c for c in cands if not c["problems"]] or sorted(cands, key=lambda c: len(c["problems"]))[:1]
        return max(pool, key=lambda c: (c["clap"]["sim"] if c.get("clap") else 0.0))

    def _run_music(self, j, d, t_start):
        import numpy as np, soundfile as sf, post
        p = j["p"]
        sec = float(p["seconds"])
        loop = bool(p.get("loop", True))
        ncand = max(1, min(5, int(p.get("candidates") or 1)))
        want_score = ncand > 1 or bool(p.get("score"))
        cands = []
        gen_total = 0.0
        tries = 0
        while tries < ncand + 3:
            seed = (int(p["seed"]) + tries * 7919) & 0x7fffffff
            self._set(j, "generating", "Composing" if tries == 0 else f"Composing another take ({tries + 1})")
            xf = 2.0
            # loops: generate 8 s extra and drop it again, because generated tracks end with an outro / fade that would not loop
            keep = sec + xf + 0.5 if loop else sec + 2.0
            gen_sec = max(10.0, keep + (8.0 if loop else 0.0))
            wav = os.path.join(d, f"raw_{tries}.wav")
            r = self._gen(self.music, {"cmd": "gen", "id": f"{j['id']}-{tries}", "prompt": p["prompt"], "seconds": gen_sec, "seed": seed,
                                       "bpm": p.get("bpm"), "steps": 8, "out": wav}, "music generation", "music_cold", "music_warm")
            gen_total += r.get("seconds", 0)
            self._set(j, "processing", "Mastering the music")
            raw, sr = sf.read(wav, dtype="float32")
            if loop:
                raw = raw[: int(keep * sr)]
            a = post.analyze(raw, sr)
            y = post.process_music(raw, sr, loop=loop, bpm=p.get("bpm"), xf_s=xf, seconds=sec if not loop else None)
            b = post.analyze(y, sr)
            seam = post.loop_seam(y) if loop else None
            pr = []
            if a["peak_db"] < -40:
                pr.append("silent output")
            if a["active_frac"] < (0.8 if loop else 0.55):
                pr.append(f"gaps in the music (active {a['active_frac']})")
            if seam is not None and seam > 4.0:
                pr.append(f"loop seam jump x{seam:.1f}")
            if b["clip_frac"] > 0.002:
                pr.append("clipping")
            clap = None
            if want_score and not pr:
                sw = os.path.join(d, f"cand_{tries}.wav")
                m = y.mean(axis=1) if y.ndim > 1 else y
                sf.write(sw, m, sr, subtype="FLOAT")
                clap = self._score(self.music, sw, p["prompt"])
            cands.append({"y": y, "br": int(p.get("bitrate") or 112000), "raw": a, "fin": b, "seam": seam, "problems": pr, "seed": seed, "clap": clap})
            tries += 1
            if len([c for c in cands if not c["problems"]]) >= ncand:
                break
            self.log(f"job {j['id']} take {tries} rejected: {pr}")
        best = self._pick(cands)
        self._finish(j, d, best, gen_total, t_start, 48000, kind="music-loop" if loop else "music-stinger", takes=len(cands))

    def _finish(self, j, d, best, gen_total, t_start, sr, kind, takes=1):
        import post
        out = os.path.join(d, "out.ogg")
        size = post.encode_ogg(out, best["y"], sr, best["br"])
        st = {"kind": kind, "bytes": size, "duration": best["fin"]["duration"], "channels": 1 if best["y"].ndim == 1 else best["y"].shape[1],
              "final": best["fin"], "raw": best["raw"], "loop_seam": None if best["seam"] is None else round(best["seam"], 2),
              "warnings": best["problems"], "seed": best["seed"], "gen_seconds": round(gen_total, 1), "total_seconds": round(time.time() - t_start, 1),
              "bitrate": best["br"], "takes": takes, "clap": best.get("clap")}
        with self.lock:
            j["file_path"], j["stats"], j["state"], j["message"], j["error"] = out, st, "done", "Done", None
        self.log(f"job {j['id']} done in {st['total_seconds']}s: {kind} {st['duration']}s {size} B takes={takes} clap={st['clap']} warnings={best['problems']}")

    def _idle_loop(self):
        while not self.stop.wait(10):
            if self.idle and not self.current and self.q.empty() and time.time() - self.last_activity > self.idle:
                if self.sfx.alive() or self.music.alive():
                    self.log(f"idle for {self.idle}s: unloading models")
                    self.unload()

    def shutdown(self):
        self.stop.set()
        self.sfx.kill()
        self.music.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18775)
    ap.add_argument("--root", default="/mnt/d/omnissiah")
    ap.add_argument("--idle", type=int, default=300)
    ap.add_argument("--job-timeout", type=int, default=420)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    w = Worker(a.root, a.idle, a.job_timeout)

    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, w.health())
            if self.path.startswith("/jobs/"):
                v = w.view(self.path[6:].split("?")[0])
                return self._send(200 if v else 404, v or {"error": "unknown job"})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}") if n < 65536 else {}
            except Exception:
                return self._send(400, {"error": "bad json"})
            if self.path in ("/sfx", "/music"):
                prompt = clean_prompt(body.get("prompt"))
                if not prompt:
                    return self._send(400, {"error": "empty prompt"})
                try:
                    seed = int(body.get("seed"))
                except (TypeError, ValueError):
                    seed = int.from_bytes(os.urandom(3), "big")
                if self.path == "/sfx":
                    try:
                        sec = min(30.0, max(0.4, float(body.get("seconds") or 2.0)))
                    except (TypeError, ValueError):
                        sec = 2.0
                    p = {"prompt": prompt, "seconds": round(sec, 1), "seed": seed, "loop": bool(body.get("loop")), "single": bool(body.get("single")),
                         "expect": body.get("expect") if isinstance(body.get("expect"), dict) else None, "bitrate": body.get("bitrate"),
                         "candidates": body.get("candidates"), "score": bool(body.get("score"))}
                    if p["loop"]:
                        p["seconds"] = max(6.0, p["seconds"])
                    j = w.submit("sfx", p)
                else:
                    try:
                        sec = min(240.0, max(4.0, float(body.get("seconds") or 60.0)))
                    except (TypeError, ValueError):
                        sec = 60.0
                    bpm = body.get("bpm")
                    p = {"prompt": prompt, "seconds": round(sec, 1), "seed": seed, "loop": body.get("loop", True) is not False,
                         "bpm": int(bpm) if isinstance(bpm, (int, float)) and 40 <= bpm <= 220 else None, "bitrate": body.get("bitrate"),
                         "candidates": body.get("candidates"), "score": bool(body.get("score"))}
                    j = w.submit("music", p)
                return self._send(200, {"job": j["id"], "state": j["state"]})
            if self.path == "/unload":
                return self._send(200, {"unloaded": w.unload()})
            if self.path == "/shutdown":
                self._send(200, {"ok": True})
                threading.Thread(target=lambda: (time.sleep(0.2), w.shutdown(), os._exit(0)), daemon=True).start()
                return
            self._send(404, {"error": "not found"})

    srv = ThreadingHTTPServer((a.host, a.port), H)
    srv.daemon_threads = True

    def bye(*_):
        w.shutdown()
        os._exit(0)

    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    w.log(f"worker listening on {a.host}:{a.port}, root {a.root}, idle {a.idle}s")
    print(f"audio worker listening on {a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
