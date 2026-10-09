"""Listen-by-proxy: CLAP (laion/clap-htsat-unfused, Apache-2.0) text<->audio similarity.
For every generated file the similarity to its own prompt is compared with all other prompts in the spec; a file
whose own prompt is not within the top-K retrieval is suspicious. Run with ~/audio/moss/bin/python:
  python clap_check.py <audio dir> <spec.json> [topk=8] [--names a,b]
spec.json = [{"file": "x-0.ogg", "name": "x", "prompt": "..."}]  (written by dump_spec.mjs)"""
import json, os, sys
os.environ.setdefault("HF_HOME", os.path.expanduser("~/audio/hfhome"))
import numpy as np, torch, av
from transformers import ClapModel, ClapProcessor

audio_dir, spec_file = sys.argv[1], sys.argv[2]
topk = int(sys.argv[3]) if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else 8
names = None
if "--names" in sys.argv:
    names = set(sys.argv[sys.argv.index("--names") + 1].split(","))
spec = json.load(open(spec_file))
files = [s for s in spec if os.path.exists(os.path.join(audio_dir, s["file"])) and (names is None or s["name"] in names)]
all_prompts = sorted({s["prompt"] for s in spec})
model = ClapModel.from_pretrained("laion/clap-htsat-unfused").to("cuda").eval()
proc = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
SR = 48000


def load(path):
    c = av.open(path)
    chunks = [f.to_ndarray() for f in c.decode(audio=0)]
    c.close()
    a = np.concatenate(chunks, axis=1).astype(np.float32)
    if a.dtype != np.float32 or np.abs(a).max() > 1.5:
        a = a / 32768.0
    a = a.mean(axis=0) if a.shape[0] > 1 else a[0]
    return a


with torch.no_grad():
    tin = proc(text=all_prompts, return_tensors="pt", padding=True).to("cuda")
    temb = torch.nn.functional.normalize(model.get_text_features(**tin), dim=-1)
    out = []
    for s in files:
        a = load(os.path.join(audio_dir, s["file"]))
        if len(a) > 10 * SR:  # CLAP takes 10 s: use the middle
            m = len(a) // 2
            a = a[m - 5 * SR: m + 5 * SR]
        if len(a) < SR // 2:
            a = np.pad(a, (0, SR // 2 - len(a)))
        ain = proc(audios=[a], sampling_rate=SR, return_tensors="pt").to("cuda")
        aemb = torch.nn.functional.normalize(model.get_audio_features(**ain), dim=-1)
        sims = (aemb @ temb.T)[0].cpu().numpy()
        order = np.argsort(-sims)
        own = all_prompts.index(s["prompt"])
        rank = int(np.nonzero(order == own)[0][0]) + 1
        out.append({"file": s["file"], "name": s["name"], "sim": float(sims[own]), "rank": rank, "of": len(all_prompts),
                    "top": [all_prompts[i][:50] for i in order[:2]]})
bad = [o for o in out if o["rank"] > topk]
print(json.dumps({"checked": len(out), "suspicious": len(bad), "topk": topk, "median_rank": float(np.median([o["rank"] for o in out])) if out else None,
                  "mean_sim": float(np.mean([o["sim"] for o in out])) if out else None}))
for o in sorted(out, key=lambda o: -o["rank"]):
    flag = "BAD " if o["rank"] > topk else "ok  "
    print(f"{flag}{o['file']:28s} rank {o['rank']:3d}/{o['of']} sim {o['sim']:.3f}  {'' if o['rank'] <= 1 else 'heard as: ' + ' | '.join(o['top'])}")
json.dump(out, open(os.path.join(audio_dir, "_clap.json"), "w"), indent=1)
