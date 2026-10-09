#!/usr/bin/env python3
"""Omnissiah travel worker: a tiny localhost HTTP service (stdlib only) that turns a place description into a seamless
equirectangular panorama + derived world state. Runs inside WSL in ~/travel/venv. Same shape as server/gen3d/worker.py.

  pano_runner.py   (Z-Image-Turbo, subprocess, JSON lines)   text -> 2048x1024 periodic panorama (+ optional 4096 refine)
  analyze.py       (numpy/opencv, in-process)                seam check, pole fix, horizon, palette, sun, ground, outputs

One job at a time, FIFO. Idle for IDLE seconds -> the runner is killed (VRAM + RAM released); it restarts on the next job.

  POST /place {prompt, slug?, seed?, hi?: 'fast'|'refine'}  -> {job, state}
  GET  /jobs/<id>   -> {state: queued|dreaming|refining|analyzing|done|error, progress, message, out_dir, meta, stats, error}
  GET  /health      -> {ok, ...}          POST /unload   POST /shutdown
"""
import argparse, json, os, queue, signal, subprocess, sys, threading, time, traceback, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
PY = os.environ.get("TRAVEL_PY", os.path.join(HOME, "travel", "venv", "bin", "python"))
sys.path.insert(0, HERE)

EXPECT = {"dreaming": 45.0, "refining": 240.0, "analyzing": 6.0}


class Log:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = open(path, "a", buffering=1, encoding="utf-8")
        self.lock = threading.Lock()

    def __call__(self, *a):
        with self.lock:
            self.f.write(time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


class Runner:
    """A JSON-lines subprocess (same contract as gen3d's Runner)."""

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
                raise RuntimeError(f"{self.name} runner failed to start: {ev.get('error', 'exited')}")

    def _reader(self, proc):
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
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

    def request(self, req, timeout, on_event=None):
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
            e = ev.get("event")
            if e == "eof" or e == "fatal":
                self.kill()
                raise RuntimeError(f"{self.name} runner crashed")
            if e == "result" and ev.get("id") == req.get("id"):
                return ev
            if on_event:
                on_event(ev)

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


class Worker:
    def __init__(self, root, idle, job_timeout):
        self.root = root
        self.logdir = os.path.join(root, ".cache", "travel")
        self.jobdir = os.path.join(self.logdir, "jobs")
        os.makedirs(self.jobdir, exist_ok=True)
        self.log = Log(os.path.join(self.logdir, "worker.log"))
        self.idle, self.job_timeout = idle, job_timeout
        self.jobs, self.order = {}, []
        self.q = queue.Queue()
        self.lock = threading.Lock()
        self.current = None
        self.last_activity = time.time()
        self.started = time.time()
        self.stop = threading.Event()
        base = dict(os.environ)
        env = dict(base, HF_HUB_CACHE=os.path.join(HOME, "gen3d", "hf"))
        self.pano = Runner("pano", [PY, "-u", os.path.join(HERE, "pano_runner.py")], env, self.logdir, self.log)
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._idle_loop, daemon=True).start()

    def submit(self, prompt, slug, seed, hi, image=None, fov=None, horizon_y=None):
        job = {"id": uuid.uuid4().hex[:12], "prompt": prompt, "slug": slug, "seed": seed, "hi": hi,
               "state": "queued", "message": "Waiting in line", "created": time.time(), "stage_t0": None,
               "out_dir": None, "meta": None, "stats": None, "error": None, "image": image, "fov": fov, "horizon_y": horizon_y}
        with self.lock:
            self.jobs[job["id"]] = job
            self.order.append(job["id"])
            while len(self.order) > 200:
                self.jobs.pop(self.order.pop(0), None)
        self.q.put(job["id"])
        self.log(f"job {job['id']} queued: {slug} hi={hi} {prompt!r}")
        return job

    def view(self, jid):
        with self.lock:
            j = self.jobs.get(jid)
            if not j:
                return None
            v = {k: j[k] for k in ("id", "prompt", "slug", "state", "message", "out_dir", "meta", "stats", "error")}
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
        lo, hi = {"dreaming": (0.02, 0.75 if j["hi"] != "refine" else 0.3), "refining": (0.3, 0.9), "analyzing": (0.9, 0.99)}[s]
        el = time.time() - (j["stage_t0"] or time.time())
        p = round(lo + (hi - lo) * min(el / EXPECT[s], 0.97), 3)
        j["pmax"] = max(j.get("pmax", 0.0), p)
        return j["pmax"]

    def health(self):
        with self.lock:
            cur = self.current
            queued = sum(1 for i in self.order if self.jobs[i]["state"] == "queued")
        return {"ok": True, "uptime": round(time.time() - self.started), "current": cur, "queued": queued,
                "pano_loaded": self.pano.alive(), "idle_seconds": round(time.time() - self.last_activity), "idle_unload_after": self.idle}

    def unload(self):
        if self.current:
            return False
        self.pano.kill()
        return True

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
                    self.log(f"job {jid} failed ({e}); retrying once")
                    self._run(j)
            except Exception as e:
                self.log(f"job {jid} error: {e}\n{traceback.format_exc()}")
                with self.lock:
                    j["state"], j["error"], j["message"] = "error", str(e), str(e)
            finally:
                self.current = None
                self.last_activity = time.time()

    def _run(self, j):
        import analyze  # numpy + opencv, light
        t_start = time.time()
        d = os.path.join(self.jobdir, j["id"])
        os.makedirs(d, exist_ok=True)
        base, hi_out, out = os.path.join(d, "base.png"), os.path.join(d, "hi.png"), os.path.join(d, "out")

        def left():
            return max(60.0, self.job_timeout - (time.time() - t_start))

        self._set(j, "dreaming", "Dreaming up the place" if self.pano.alive() else "Waking the dreamer (first place after idle takes a little longer)")
        req = {"cmd": "gen", "id": j["id"], "prompt": j["prompt"], "seed": j["seed"], "out": base, "width": 2048, "height": 1024}
        if j["hi"] == "refine":
            req["hi_out"] = hi_out
        if j.get("image"):  # options.image: the picture becomes the view in front of the player, the rest is invented around it
            req["image"], req["fov"], req["horizon_y"] = j["image"], j.get("fov") or 80, j.get("horizon_y") or 0.5
            req["prompt"] = j["prompt"] + ", the scene of the photograph in the middle of the image continues seamlessly all around it with the same light, colours, materials and style"

        def on_event(ev):
            pass

        r = self.pano.request(req, timeout=left(), on_event=on_event)
        if not r.get("ok"):
            raise ValueError(r.get("error") or "panorama generation failed")
        EXPECT["dreaming"] = 0.5 * EXPECT["dreaming"] + 0.5 * r.get("base_seconds", 45) + 0.5 * 10
        self._set(j, "analyzing", "Reading the light and the ground")
        meta = analyze.process(base, out, hi_out if j["hi"] == "refine" else None)
        if j.get("image"):
            meta["fromImage"] = True  # the client then keeps the picture in front (no sun-avoiding yaw)
            with open(os.path.join(out, "meta.json"), "w") as fh:
                json.dump(meta, fh, indent=1)
        try:
            analyze.views_sheet(os.path.join(out, "pano_2048.jpg"), os.path.join(out, "views.png"))
        except Exception as e:
            self.log(f"views failed: {e}")
        st = {k: r.get(k) for k in ("seconds", "load_seconds", "base_seconds", "vram_peak_gb", "fp8", "prompt_used")}
        st["total_seconds"] = round(time.time() - t_start, 1)
        with self.lock:
            j["out_dir"], j["meta"], j["stats"], j["state"], j["message"], j["error"] = out, meta, st, "done", "Done", None
        self.log(f"job {j['id']} done in {st['total_seconds']}s")

    def _idle_loop(self):
        while not self.stop.wait(15):
            if self.idle and not self.current and self.q.empty() and time.time() - self.last_activity > self.idle:
                if self.pano.alive():
                    self.log(f"idle for {self.idle}s: unloading the model")
                    self.unload()

    def shutdown(self):
        self.stop.set()
        self.pano.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18780)
    ap.add_argument("--root", default="/mnt/d/omnissiah")
    ap.add_argument("--idle", type=int, default=600)
    ap.add_argument("--job-timeout", type=int, default=900)
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
            if self.path == "/place":
                prompt = " ".join(str(body.get("prompt", "")).split())[:400]
                if not prompt:
                    return self._send(400, {"error": "empty prompt"})
                try:
                    seed = int(body.get("seed"))
                except (TypeError, ValueError):
                    seed = int.from_bytes(os.urandom(3), "big")
                slug = str(body.get("slug") or "place")[:60]
                hi = "refine" if body.get("hi") == "refine" else "fast"
                image = body.get("image")
                if image is not None and not (isinstance(image, str) and image.startswith("/mnt/") and os.path.isfile(image)):
                    return self._send(400, {"error": "image not found"})
                try:
                    fov = float(body.get("fov")) if body.get("fov") is not None else None
                except (TypeError, ValueError):
                    fov = None
                try:
                    hy = float(body.get("horizon_y")) if body.get("horizon_y") is not None else None
                except (TypeError, ValueError):
                    hy = None
                j = w.submit(prompt, slug, seed, hi, image, fov, hy)
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
    print(f"travel worker listening on {a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
