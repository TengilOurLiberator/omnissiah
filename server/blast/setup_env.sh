#!/bin/bash
# Creates ~/blast: a venv that sees ~/gen3d/env's site-packages (torch 2.7.1+cu128, diffusers 0.41, transformers 5.19; read only) plus the
# FLUX.2 [klein] 4B weights (Apache-2.0, not gated). Nothing under /opt/trellis, ~/gen3d, ~/voice, ~/audio, ~/rig, ~/travel is modified.
# Usage: bash setup_env.sh [model ...]     models: klein4b (default)
set -e
BASE=$HOME/gen3d/env/bin/python
mkdir -p ~/blast/hf
if [ ! -x ~/blast/venv/bin/python ]; then
  $BASE -m venv --system-site-packages ~/blast/venv
fi
~/blast/venv/bin/python -m pip install --quiet --disable-pip-version-check scipy 2>&1 | tail -2 || true
export HF_HOME=$HOME/blast/hf HF_HUB_DISABLE_TELEMETRY=1
MODELS=${@:-klein4b}
for m in $MODELS; do
  case $m in
    klein4b) REPO=black-forest-labs/FLUX.2-klein-4B; DIR=klein4b ;;
    qwen-edit) REPO=Qwen/Qwen-Image-Edit-2509; DIR=qwen-edit ;;
    *) echo "unknown model $m"; continue ;;
  esac
  echo "downloading $REPO -> ~/blast/$DIR"
  ~/blast/venv/bin/python - "$REPO" "$HOME/blast/$DIR" <<'EOF'
import sys
from huggingface_hub import snapshot_download
p = snapshot_download(sys.argv[1], local_dir=sys.argv[2], allow_patterns=["*.json", "*.safetensors", "*.txt", "tokenizer*", "*.model"], max_workers=8)
print("done", p)
EOF
done
du -sh ~/blast/* 2>/dev/null
