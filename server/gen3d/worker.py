#!/usr/bin/env python3
"""Omnissiah gen3d worker: a tiny localhost HTTP service (stdlib only) that turns a text wish into a
game-ready GLB. Runs inside WSL. It owns two long-lived runner subprocesses so models stay loaded:

  t2i_runner.py      (~/gen3d/env, Z-Image-Turbo)    text  -> 1024px image
  trellis_runner.py  (trellis2 env, TRELLIS.2-4B)     image -> normalised, decimated, textured GLB

One job at a time, FIFO. Idle for IDLE seconds -> all runners are killed (all VRAM + RAM released);
they start again on the next job.

A third runner (rig_runner.py, ~/rig/env, UniRig + procedural animation) turns the finished GLB into a rigged, animated one
when the job asks for it (`animate`), or on its own for an already cached model (POST /rig). It never loads together with the
text-to-image models, and TRELLIS is unloaded first when WSL has less than RIG_MIN_FREE_GB of RAM available.

  POST /generate {prompt, quality: low|standard|high, seed?, animate?: bool, image?: "/mnt/.../x.png"}   -> {job, state}
                 (image: skip text-to-image, use this picture of one object)
  POST /rig      {glb_path, prompt, force?}                    -> {job, state}   (rig an existing GLB)
  GET  /jobs/<id>   -> {state: queued|imagining|sculpting|exporting|done|error, progress, message,
                        glb_path, image_path, stats, error}
  GET  /health      -> {ok, ...}          POST /unload   POST /shutdown
"""
import argparse, json, os, queue, signal, subprocess, sys, threading, time, traceback, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
T2I_PY = os.environ.get("GEN3D_T2I_PY", os.path.join(HOME, "gen3d", "env", "bin", "python"))
TRELLIS_ENV = os.environ.get("GEN3D_TRELLIS_ENV", "/opt/trellis/mamba/envs/trellis2")
RIG_PY = os.environ.get("GEN3D_RIG_PY", os.path.join(HOME, "rig", "env", "bin", "python"))
QUALITIES = ("low", "standard", "high")
RIG_BUDGET = float(os.environ.get("GEN3D_RIG_BUDGET", "360"))      # seconds for a whole animated job; beyond that the static model is delivered
RIG_MIN_FREE_GB = float(os.environ.get("GEN3D_RIG_MIN_FREE_GB", "9"))

# rough expected durations, only used to animate the progress bar (updated from real timings)
EXPECT = {"imagining": 15.0, "sculpting": 40.0, "exporting": 10.0, "rigging": 60.0}


class Log:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = open(path, "a", buffering=1, encoding="utf-8")
        self.lock = threading.Lock()

    def __call__(self, *a):
        with self.lock:
            self.f.write(time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


class Runner:
    """A JSON-lines subprocess. Events arrive on a reader thread; request() blocks for the result."""

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
        """Send one request, return its result event. Raises on crash/timeout (runner is killed)."""
        self.start()
        while True:  # drop stale events
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
        self.logdir = os.path.join(root, ".cache", "gen3d")
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
        t2i_env = dict(base, HF_HUB_CACHE=os.path.join(HOME, "gen3d", "hf"))
        tr_env = dict(base,
                      PATH=f"{TRELLIS_ENV}/bin:" + base.get("PATH", ""),
                      HF_HOME=os.path.join(HOME, ".cache", "huggingface"),
                      LD_LIBRARY_PATH=f"{TRELLIS_ENV}/targets/x86_64-linux/lib:{TRELLIS_ENV}/lib:/usr/lib/wsl/lib")
        self.t2i = Runner("t2i", [T2I_PY, "-u", os.path.join(HERE, "t2i_runner.py")], t2i_env, self.logdir, self.log)
        self.trellis = Runner("trellis", [f"{TRELLIS_ENV}/bin/python", "-u", os.path.join(HERE, "trellis_runner.py")],
                              tr_env, self.logdir, self.log)
        rig_env = dict(base, HF_HOME=os.path.join(HOME, "rig", "hf"), RIG_TMP=os.path.join(self.logdir, "rigtmp"))
        os.makedirs(rig_env["RIG_TMP"], exist_ok=True)
        self.rig = Runner("rig", [RIG_PY, "-u", os.path.join(HERE, "rig_runner.py")], rig_env, self.logdir, self.log, ready_timeout=300)
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._idle_loop, daemon=True).start()

    # ---------------------------------------------------------------- API
    def submit(self, prompt, quality, seed, animate=False, source_glb=None, force=False, image=None):
        job = {"id": uuid.uuid4().hex[:12], "prompt": prompt, "quality": quality, "seed": seed, "animate": bool(animate),
               "source_glb": source_glb, "force": bool(force), "rig": None, "input_image": image,
               "state": "queued", "message": "Waiting in line", "created": time.time(), "stage_t0": None,
               "glb_path": None, "image_path": None, "stats": None, "error": None}
        with self.lock:
            self.jobs[job["id"]] = job
            self.order.append(job["id"])
            while len(self.order) > 200:
                self.jobs.pop(self.order.pop(0), None)
        self.q.put(job["id"])
        self.log(f"job {job['id']} queued: {quality} {prompt!r}")
        return job

    def view(self, jid):
        with self.lock:
            j = self.jobs.get(jid)
            if not j:
                return None
            v = {k: j[k] for k in ("id", "prompt", "quality", "state", "message", "glb_path", "image_path", "stats", "error", "rig")}
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
        if j.get("animate") or j.get("source_glb"):
            bands = {"imagining": (0.02, 0.12), "sculpting": (0.12, 0.5), "exporting": (0.5, 0.6), "rigging": (0.6, 0.98)}
            if j.get("source_glb"):
                bands = {"rigging": (0.03, 0.98)}
        else:
            bands = {"imagining": (0.02, 0.18), "sculpting": (0.18, 0.85), "exporting": (0.85, 0.99)}
        lo, hi = bands.get(s, (0.5, 0.9))
        el = time.time() - (j["stage_t0"] or time.time())
        p = round(lo + (hi - lo) * min(el / EXPECT[s], 0.97), 3)
        j["pmax"] = max(j.get("pmax", 0.0), p)  # never run backwards
        return j["pmax"]

    def health(self):
        with self.lock:
            cur = self.current
            queued = sum(1 for i in self.order if self.jobs[i]["state"] == "queued")
        return {"ok": True, "uptime": round(time.time() - self.started), "current": cur, "queued": queued,
                "t2i_loaded": self.t2i.alive(), "trellis_loaded": self.trellis.alive(), "rig_loaded": self.rig.alive(),
                "idle_seconds": round(time.time() - self.last_activity), "idle_unload_after": self.idle}

    def unload(self):
        if self.current:
            return False
        self.t2i.kill()
        self.trellis.kill()
        self.rig.kill()
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
                    # a runner crashed or hung: it has been killed; retry the whole job once on fresh runners
                    self.log(f"job {jid} failed ({e}); retrying once")
                    self._run(j)
            except Exception as e:
                self.log(f"job {jid} error: {e}\n{traceback.format_exc()}")
                with self.lock:
                    j["state"], j["error"], j["message"] = "error", str(e), str(e)
            finally:
                self.current = None
                self.last_activity = time.time()

    def _free_ram_gb(self):
        try:
            with open("/proc/meminfo") as fh:
                for ln in fh:
                    if ln.startswith("MemAvailable"):
                        return int(ln.split()[1]) / 2**20
        except Exception:
            pass
        return 99.0

    def _rig_stage(self, j, glb_in, d, t_start, budget):
        """Rig `glb_in` (UniRig + procedural clips). Returns the rigged glb path, or None (static model is kept).
        Never raises: any failure becomes a message on the job and the static model is delivered."""
        rigged = os.path.join(d, "model_rigged.glb")
        j["rig"] = {"requested": True}
        t_rig = time.time()
        try:
            self._set(j, "rigging", "Finding its bones")
            if not self.rig.alive():
                # one big model at a time: free TRELLIS (and the text models) before UniRig loads
                free = self._free_ram_gb()
                if free < RIG_MIN_FREE_GB:
                    self.log(f"job {j['id']}: only {free:.1f} GB RAM free, unloading TRELLIS before rigging")
                    self.trellis.kill()
                    self.t2i.kill()
            def on_event(ev):
                if ev.get("event") == "stage" and ev.get("state") == "sculpting":
                    self._set(j, "rigging", ev.get("message") or "Finding its bones")
            left = max(45.0, budget - (time.time() - t_rig))      # the budget is for the ADDED rigging time, not the whole job
            r = self.rig.request({"cmd": "rig", "id": j["id"] + "r", "glb": glb_in, "out": rigged, "prompt": j["prompt"],
                                  "seed": 1, "force": j.get("force", False), "budget": left * 0.8,
                                  "debug_dir": os.path.join(d, "rigdebug")}, timeout=left, on_event=on_event)
            if not r.get("ok"):
                raise ValueError(r.get("error") or "rigging failed")
            if not r.get("rigged"):
                j["rig"] = {"requested": True, "rigged": False, "reason": r.get("reason"), "stats": r.get("stats"), "seconds": round(time.time() - t_rig, 1)}
                self.log(f"job {j['id']}: not rigged ({r.get('reason')})")
                return None
            j["rig"] = {"requested": True, "rigged": True, "meta": r["meta"], "stats": r.get("stats"), "seconds": round(time.time() - t_rig, 1)}
            self.log(f"job {j['id']}: rigged as {r['meta']['bodyPlan']} in {j['rig']['seconds']}s, {r['meta']['bones']} bones, clips {r['meta']['clips']}")
            return rigged
        except TimeoutError as e:
            j["rig"] = {"requested": True, "rigged": False, "transient": True, "reason": f"rigging took longer than the {budget:.0f}s budget", "seconds": round(time.time() - t_rig, 1)}
        except Exception as e:
            self.log(f"job {j['id']}: rigging failed: {e}\n{traceback.format_exc()}")
            j["rig"] = {"requested": True, "rigged": False, "transient": True, "reason": f"{type(e).__name__}: {e}", "seconds": round(time.time() - t_rig, 1)}
            self.rig.kill()
        return None

    def _run(self, j):
        t_start = time.time()
        d = os.path.join(self.jobdir, j["id"])
        os.makedirs(d, exist_ok=True)
        if j.get("source_glb"):          # rig an existing model, no generation
            out = self._rig_stage(j, j["source_glb"], d, t_start, RIG_BUDGET)
            with self.lock:
                j["glb_path"] = out or j["source_glb"]
                j["stats"] = {"total_seconds": round(time.time() - t_start, 1), "rig": j["rig"]}
                j["state"], j["message"], j["error"] = "done", "Done" if out else "Kept static: " + str((j["rig"] or {}).get("reason")), None
            return
        image = os.path.join(d, "image.png")
        glb = os.path.join(d, "model.glb")

        def left():
            return max(30.0, self.job_timeout - (time.time() - t_start))

        if j.get("input_image"):
            # image-input mode: the caller supplied the picture (one object on a plain background); no text-to-image stage
            image = j["input_image"]
            j["image_path"] = image
            r = {"seconds": 0, "prompt_used": None, "vram_peak_gb": None, "from_image": True}
        else:
            self._set(j, "imagining", "Dreaming up a picture")
            r = self.t2i.request({"cmd": "gen", "id": j["id"], "prompt": j["prompt"], "seed": j["seed"], "out": image},
                                 timeout=left())
            if not r.get("ok"):
                raise ValueError(r.get("error") or "image generation failed")
            j["image_path"] = image
            EXPECT["imagining"] = 0.5 * EXPECT["imagining"] + 0.5 * r.get("seconds", 15)

        def on_event(ev):
            if ev.get("event") == "stage" and ev.get("state") in ("sculpting", "exporting"):
                self._set(j, ev["state"], ev.get("message") or ev["state"])

        self._set(j, "sculpting", "Sculpting the form" if self.trellis.alive() else "Waking the sculptor (first job after idle takes about a minute longer)")
        r2 = self.trellis.request({"cmd": "run", "id": j["id"], "image": image, "seed": j["seed"], "quality": j["quality"],
                                   "out": glb, "cutout": os.path.join(d, "cutout.png")},
                                  timeout=left(), on_event=on_event)
        if not r2.get("ok"):
            raise ValueError(r2.get("error") or "3D generation failed")
        st = r2.get("stats", {})
        st["imagine_seconds"] = r.get("seconds")
        st["imagine_vram_peak_gb"] = r.get("vram_peak_gb")
        st["prompt_used"] = r.get("prompt_used")
        st["total_seconds"] = round(time.time() - t_start, 1)
        EXPECT["sculpting"] = 0.5 * EXPECT["sculpting"] + 0.5 * st.get("sculpt_seconds", 40)
        EXPECT["exporting"] = 0.5 * EXPECT["exporting"] + 0.5 * st.get("bake_seconds", 10)
        if j.get("animate"):
            out = self._rig_stage(j, glb, d, t_start, RIG_BUDGET)
            st["rig"] = j["rig"]
            st["total_seconds"] = round(time.time() - t_start, 1)
            if out:
                glb = out
        with open(os.path.join(d, "stats.json"), "w") as f:
            json.dump(st, f, indent=1)
        with self.lock:
            j["glb_path"], j["stats"], j["state"], j["message"], j["error"] = glb, st, "done", "Done", None
        self.log(f"job {j['id']} done in {st['total_seconds']}s: {st.get('triangles')} tris, {st.get('bytes')} bytes")

    def _idle_loop(self):
        while not self.stop.wait(15):
            if self.idle and not self.current and self.q.empty() and time.time() - self.last_activity > self.idle:
                if self.t2i.alive() or self.trellis.alive() or self.rig.alive():
                    self.log(f"idle for {self.idle}s: unloading models")
                    self.unload()

    def shutdown(self):
        self.stop.set()
        self.t2i.kill()
        self.trellis.kill()
        self.rig.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18765)
    ap.add_argument("--root", default="/mnt/d/omnissiah")
    ap.add_argument("--idle", type=int, default=600)
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
                body = json.loads(self.rfile.read(n) or b"{}") if n < 65536 else {}
            except Exception:
                return self._send(400, {"error": "bad json"})
            if self.path == "/generate":
                prompt = " ".join(str(body.get("prompt", "")).split())[:300]
                img = str(body.get("image") or "")
                if img and (not img.startswith("/mnt/") or not os.path.isfile(img)):
                    return self._send(400, {"error": "image must be an existing /mnt/... file"})
                if not prompt and not img:
                    return self._send(400, {"error": "empty prompt"})
                q = body.get("quality") if body.get("quality") in QUALITIES else "standard"
                try:
                    seed = int(body.get("seed"))
                except (TypeError, ValueError):
                    seed = int.from_bytes(os.urandom(3), "big")
                j = w.submit(prompt or "an object", q, seed, animate=bool(body.get("animate")), image=img or None)
                return self._send(200, {"job": j["id"], "state": j["state"]})
            if self.path == "/rig":
                src = str(body.get("glb_path", ""))
                if not src.startswith("/mnt/") or not os.path.isfile(src):
                    return self._send(400, {"error": "glb_path must be an existing /mnt/... file"})
                j = w.submit(" ".join(str(body.get("prompt", "")).split())[:300], "standard", 0, animate=True, source_glb=src, force=bool(body.get("force")))
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
    print(f"gen3d worker listening on {a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()



