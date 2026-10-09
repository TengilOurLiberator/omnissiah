"""One-off: re-save the Z-Image-Turbo checkpoint as bf16 (halves disk + load time).
Run with ~/gen3d/env/bin/python. Output: ~/gen3d/zimage-turbo-bf16"""
import os, shutil, torch, gc, glob
from diffusers import ZImageTransformer2DModel
from transformers import AutoModel

src = glob.glob(os.path.expanduser("~/gen3d/hf/models--Tongyi-MAI--Z-Image-Turbo/snapshots/*"))[0]
dst = os.path.expanduser("~/gen3d/zimage-turbo-bf16")
os.makedirs(dst, exist_ok=True)
for d in ("scheduler", "tokenizer", "vae"):
    shutil.copytree(os.path.join(src, d), os.path.join(dst, d), dirs_exist_ok=True)
for f in ("model_index.json", "README.md"):
    shutil.copy(os.path.join(src, f), dst)
tr = ZImageTransformer2DModel.from_pretrained(os.path.join(src, "transformer"), torch_dtype=torch.bfloat16)
tr.save_pretrained(os.path.join(dst, "transformer"), safe_serialization=True, max_shard_size="20GB")
del tr
gc.collect()
te = AutoModel.from_pretrained(os.path.join(src, "text_encoder"), torch_dtype=torch.bfloat16)
print(type(te))
te.save_pretrained(os.path.join(dst, "text_encoder"), safe_serialization=True, max_shard_size="20GB")
print("CONVERTED")
