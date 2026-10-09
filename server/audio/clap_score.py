"""CLAP (laion/clap-htsat-unfused, Apache-2.0) text<->audio similarity, shared by both runners. 'Listen-by-proxy':
the worker generates several candidates of a prompt and keeps the one CLAP finds closest to the text."""
import os
import numpy as np
import soundfile as sf


class ClapScorer:
    def __init__(self):
        self.model = self.proc = None
        self.bank = None
        self.bank_emb = None

    def _load(self):
        if self.model is not None:
            return
        import torch  # noqa
        from transformers import ClapModel, ClapProcessor
        cd = os.path.expanduser("~/audio/hfhome/hub")
        self.model = ClapModel.from_pretrained("laion/clap-htsat-unfused", cache_dir=cd).to("cuda").eval()
        self.proc = ClapProcessor.from_pretrained("laion/clap-htsat-unfused", cache_dir=cd)

    def _text(self, texts):
        import torch
        tin = self.proc(text=texts, return_tensors="pt", padding=True).to("cuda")
        return torch.nn.functional.normalize(self.model.get_text_features(**tin), dim=-1)

    def set_bank(self, prompts):
        import torch
        self._load()
        with torch.no_grad():
            self.bank = list(prompts)
            self.bank_emb = self._text(self.bank)
        return len(self.bank)

    def score(self, wav_path, prompt):
        import torch
        self._load()
        w, sr = sf.read(wav_path, dtype="float32")
        if w.ndim > 1:
            w = w.mean(axis=1)
        if len(w) > 10 * sr:
            m = len(w) // 2
            w = w[m - 5 * sr: m + 5 * sr]
        if len(w) < sr // 2:
            w = np.pad(w, (0, sr // 2 - len(w)))
        with torch.no_grad():
            ain = self.proc(audios=[w], sampling_rate=sr, return_tensors="pt").to("cuda")
            ae = torch.nn.functional.normalize(self.model.get_audio_features(**ain), dim=-1)
            sim = float((ae @ self._text([prompt]).T)[0, 0])
            rank = of = None
            if self.bank_emb is not None:
                sims = (ae @ self.bank_emb.T)[0]
                rank = int((sims > sim).sum().item()) + 1
                of = len(self.bank)
        return {"sim": round(sim, 4), "rank": rank, "of": of}
