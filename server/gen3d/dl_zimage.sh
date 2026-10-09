exec > /mnt/d/omnissiah/.cache/gen3d/dl_zimage.log 2>&1
export HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_CACHE=$HOME/gen3d/hf
$HOME/gen3d/env/bin/python - <<'EOF'
import diffusers
print([n for n in dir(diffusers) if 'ZImage' in n or 'Flux2' in n])
from huggingface_hub import HfApi, snapshot_download
for m in ["Tongyi-MAI/Z-Image-Turbo"]:
    info = HfApi().model_info(m, files_metadata=True)
    tot=0
    for s in info.siblings:
        print(s.rfilename, (s.size or 0)/1e9); tot+=(s.size or 0)
    print(m,"total GB",tot/1e9)
p = snapshot_download("Tongyi-MAI/Z-Image-Turbo", ignore_patterns=["assets/*"])
print("DOWNLOADED", p)
EOF