#!/usr/bin/env python3
"""Omnissiah blast worker: a tiny localhost HTTP service (stdlib only) inside WSL that owns the two image models of the blast pipeline.

  t2i_runner.py   (~/blast/venv, Z-Image-Turbo, weights read from ~/gen3d)   text  -> scene image (any size)
  edit_runner.py  (~/blast/venv, FLUX.2 [klein] 4B)                           image(s) + instruction -> edited image

One job at a time (FIFO) and ONE big model on the GPU at a time: before a job uses a runner the other one is stopped, so the peak stays
at the larger of the two (~14 GB for Z-Image, ~10 GB for klein). Idle for `--idle` seconds -> all runners are killed (VRAM + RAM freed).

  POST /generate {prompt, width=1344, height=768, seed, steps=9, out?}                       -> {job}
  POST /edit     {image | images[], prompt, role?, seed?, width?, height?, out?}  or  {items: [{id, images[], prompt, out?, seed?, width?, height?}], role?}
                                                                                              -> {job}   (all items of one call = one batch: the text encoder and the DiT
                                                                                                  load once; item results appear in /jobs/<id>.items as they finish)
  GET  /jobs/<id>  -> {state: queued|generating|editing|done|error, message, progress, items:[{id, ok, out, seconds, error}], out, stats, error}
  GET  /health     -> {ok, current, queued, t2i_loaded, edit_loaded, vram_used_mb, ...}      POST /unload     POST /shutdown
Paths are WSL paths (/mnt/d/...). `out` defaults to <root>/.cache/blast/jobs/<job>/.
"""
import argparse, json, os, queue, signal, subprocess, sys, threading, time, traceback, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
PY = os.environ.get("BLAST_PY", os.path.join(HOME, "blast", "venv", "bin", "python"))
EXPECT = {"generating": 25.0, "editing": 30.0}


class Log:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = open(path, "a", buffering=1, encoding="utf-8")
        self.lock = threading.Lock()

    def __call__(self, *a):
        with self.lock:
            self.f.write(time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


def gpu_used_mb():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5).stdout
        return int(out.strip().splitlines()[0])
    except Exception:
        return None


class Runner:
    """A JSON-lines subprocess. Events arrive on a reader thread; request() blocks for the result."""

    def __init__(self, name, argv, env, logdir, log, ready_timeout=300):
        self.name, self.argv, self.env, self.logdir, self.log, self.ready_timeout = name, argv, env, logdir, log, ready_timeout
        self.proc = None
        self.events = queue.Queue()

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def rss_mb(self):
        try:
            with open(f"/proc/{self.proc.pid}/status") as f:
                for ln in f:
                    if ln.startswith("VmRSS"):
                        return int(ln.split()[1]) // 1024
        except Exception:
            pass
        return None

    def start(self):
        if self.alive():
            return
        self.events = queue.Queue()
        errlog = open(os.path.join(self.logdir, f"{self.name}.log"), "a", buffering=1)
        errlog.write(f"\n===== {time.ctime()} start {' '.join(self.argv)}\n")
        self.log(f"[{self.name}] starting")
        self.proc = subprocess.Popen(self.argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errlog, env=self.env, text=True, bufsize=1, start_new_session=True)
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
                self.log(f"[{self.name}] ready in {time.time() - t0:.1f}s")
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
            if e in ("eof", "fatal"):
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
        self.logdir = os.path.join(root, ".cache", "blast")
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
        env = dict(os.environ, HF_HOME=os.path.join(HOME, "blast", "hf"), HF_HUB_CACHE=os.path.join(HOME, "gen3d", "hf"))
        self.t2i = Runner("t2i", [PY, "-u", os.path.join(HERE, "t2i_runner.py")], env, self.logdir, self.log)
        self.edit = Runner("edit", [PY, "-u", os.path.join(HERE, "edit_runner.py")], env, self.logdir, self.log)
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._idle_loop, daemon=True).start()

    # ---------------------------------------------------------------- API
    def submit(self, kind, spec):
        job = {"id": uuid.uuid4().hex[:12], "kind": kind, "spec": spec, "state": "queued", "message": "Waiting in line", "created": time.time(),
               "stage_t0": None, "items": [], "out": None, "stats": None, "error": None, "pmax": 0.0}
        with self.lock:
            self.jobs[job["id"]] = job
            self.order.append(job["id"])
            while len(self.order) > 200:
                self.jobs.pop(self.order.pop(0), None)
        self.q.put(job["id"])
        self.log(f"job {job['id']} queued: {kind} {json.dumps(spec)[:200]}")
        return job

    def view(self, jid):
        with self.lock:
            j = self.jobs.get(jid)
            if not j:
                return None
            v = {k: j[k] for k in ("id", "kind", "state", "message", "items", "out", "stats", "error")}
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
        n = max(1, len(j["spec"].get("items", [])) if j["kind"] == "edit" else 1)
        if j["kind"] == "edit":
            return round(min(0.97, 0.1 + 0.85 * len(j["items"]) / n), 3)
        el = time.time() - (j["stage_t0"] or time.time())
        p = round(0.05 + 0.9 * min(el / EXPECT["generating"], 0.97), 3)
        j["pmax"] = max(j["pmax"], p)
        return j["pmax"]

    def health(self):
        with self.lock:
            queued = sum(1 for i in self.order if self.jobs[i]["state"] == "queued")
        return {"ok": True, "uptime": round(time.time() - self.started), "current": self.current, "queued": queued,
                "t2i_loaded": self.t2i.alive(), "edit_loaded": self.edit.alive(), "vram_used_mb": gpu_used_mb(),
                "t2i_rss_mb": self.t2i.rss_mb() if self.t2i.alive() else None, "edit_rss_mb": self.edit.rss_mb() if self.edit.alive() else None,
                "idle_seconds": round(time.time() - self.last_activity), "idle_unload_after": self.idle}

    def unload(self):
        if self.current:
            return False
        self.t2i.kill()
        self.edit.kill()
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
                    self.log(f"job {jid} failed ({e}); retrying once")
                    j["items"] = []
                    self._run(j)
            except Exception as e:
                self.log(f"job {jid} error: {e}\n{traceback.format_exc()}")
                with self.lock:
                    j["state"], j["error"], j["message"] = "error", str(e), str(e)
            finally:
                self.current = None
                self.last_activity = time.time()

    def _sample(self, j, stop):
        peak = 0
        while not stop.wait(1.5):
            v = gpu_used_mb()
            if v:
                peak = max(peak, v)
            j.setdefault("sample", {})["gpu_peak_mb"] = peak
            r = self.t2i if j["kind"] == "generate" else self.edit
            if r.alive():
                rs = r.rss_mb()
                if rs:
                    j["sample"]["rss_peak_mb"] = max(j["sample"].get("rss_peak_mb", 0), rs)

    def _run(self, j):
        t_start = time.time()
        d = os.path.join(self.jobdir, j["id"])
        os.makedirs(d, exist_ok=True)
        spec = j["spec"]
        stop = threading.Event()
        threading.Thread(target=self._sample, args=(j, stop), daemon=True).start()
        try:
            if j["kind"] == "generate":
                self.edit.kill()   # one big model on the GPU at a time
                out = spec.get("out") or os.path.join(d, "image.png")
                os.makedirs(os.path.dirname(out), exist_ok=True)
                self._set(j, "generating", "Dreaming up a picture" if self.t2i.alive() else "Waking the painter")
                r = self.t2i.request({"cmd": "gen", "id": j["id"], "prompt": spec["prompt"], "width": spec["width"], "height": spec["height"],
                                      "seed": spec["seed"], "steps": spec.get("steps", 9), "out": out}, timeout=self.job_timeout)
                if not r.get("ok"):
                    raise ValueError(r.get("error") or "image generation failed")
                EXPECT["generating"] = 0.5 * EXPECT["generating"] + 0.5 * r.get("seconds", 25)
                st = {"seconds": r.get("seconds"), "vram_peak_gb": r.get("vram_peak_gb"), "total_seconds": round(time.time() - t_start, 1)}
                st.update(j.get("sample", {}))
                with self.lock:
                    j["out"], j["stats"], j["state"], j["message"], j["error"] = out, st, "done", "Done", None
            else:
                self.t2i.kill()
                items = spec["items"]
                for it in items:
                    it.setdefault("out", os.path.join(d, f"{it['id']}.png"))
                    os.makedirs(os.path.dirname(it["out"]), exist_ok=True)
                self._set(j, "editing", "Waking the editor" if not self.edit.alive() else "Reworking the picture")

                def on_event(ev):
                    if ev.get("event") == "item":
                        with self.lock:
                            j["items"].append({k: ev.get(k) for k in ("item", "ok", "out", "seconds", "error")} | {"id": ev.get("item")})
                            j["message"] = f"{len(j['items'])} of {len(items)}"
                r = self.edit.request({"cmd": "batch", "id": j["id"], "items": items}, timeout=self.job_timeout, on_event=on_event)
                if not r.get("ok"):
                    raise ValueError(r.get("error") or "image edit failed")
                st = dict(r.get("stats") or {})
                st["total_seconds"] = round(time.time() - t_start, 1)
                st.update(j.get("sample", {}))
                with self.lock:
                    j["stats"], j["state"], j["message"], j["error"] = st, "done", "Done", None
            self.log(f"job {j['id']} done in {round(time.time() - t_start, 1)}s {json.dumps(j['stats'])}")
        finally:
            stop.set()

    def _idle_loop(self):
        while not self.stop.wait(15):
            if self.idle and not self.current and self.q.empty() and time.time() - self.last_activity > self.idle:
                if self.t2i.alive() or self.edit.alive():
                    self.log(f"idle for {self.idle}s: unloading models")
                    self.unload()

    def shutdown(self):
        self.stop.set()
        self.t2i.kill()
        self.edit.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18785)
    ap.add_argument("--root", default="/mnt/d/omnissiah")
    ap.add_argument("--idle", type=int, default=420)
    ap.add_argument("--job-timeout", type=int, default=600)
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
                body = json.loads(self.rfile.read(n) or b"{}") if n < 262144 else {}
            except Exception:
                return self._send(400, {"error": "bad json"})
            ok_path = lambda p: isinstance(p, str) and p.startswith("/mnt/")
            if self.path == "/generate":
                prompt = " ".join(str(body.get("prompt", "")).split())[:1800]
                if not prompt:
                    return self._send(400, {"error": "empty prompt"})
                clamp = lambda v, lo, hi, d: max(lo, min(hi, int(v))) if isinstance(v, (int, float)) else d
                try:
                    seed = int(body.get("seed"))
                except (TypeError, ValueError):
                    seed = int.from_bytes(os.urandom(3), "big")
                out = body.get("out")
                if out is not None and not ok_path(out):
                    return self._send(400, {"error": "out must be a /mnt/... path"})
                j = w.submit("generate", {"prompt": prompt, "width": clamp(body.get("width"), 512, 2048, 1344), "height": clamp(body.get("height"), 512, 2048, 768),
                                          "seed": seed, "steps": clamp(body.get("steps"), 4, 20, 9), "out": out})
                return self._send(200, {"job": j["id"], "state": j["state"]})
            if self.path == "/edit":
                items = body.get("items")
                if not items:
                    imgs = body.get("images") or ([body["image"]] if body.get("image") else [])
                    items = [{"id": "0", "images": imgs, "prompt": body.get("prompt"), "out": body.get("out"), "seed": body.get("seed"),
                              "width": body.get("width"), "height": body.get("height"), "steps": body.get("steps")}]
                clean = []
                for k, it in enumerate(items[:24]):
                    imgs = it.get("images") or ([it["image"]] if it.get("image") else [])
                    prompt = " ".join(str(it.get("prompt", "")).split())[:2400]
                    if not imgs or not all(ok_path(p) and os.path.isfile(p) for p in imgs[:4]) or not prompt:
                        return self._send(400, {"error": f"item {k}: needs existing /mnt/... image(s) and a prompt"})
                    if it.get("out") is not None and not ok_path(it["out"]):
                        return self._send(400, {"error": f"item {k}: out must be a /mnt/... path"})
                    try:
                        seed = int(it.get("seed"))
                    except (TypeError, ValueError):
                        seed = 1
                    c = {"id": str(it.get("id", k)), "images": imgs[:4], "prompt": prompt, "seed": seed, "out": it.get("out")}
                    for key in ("width", "height", "steps", "guidance"):
                        if isinstance(it.get(key), (int, float)):
                            c[key] = it[key]
                    clean.append(c)
                if not clean:
                    return self._send(400, {"error": "no items"})
                j = w.submit("edit", {"items": clean, "role": body.get("role")})
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
    print(f"blast worker listening on {a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
