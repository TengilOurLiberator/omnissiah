#!/bin/bash
# Installs the rigging stack (UniRig + helpers) into ~/rig inside WSL. Idempotent-ish: safe to re-run.
# Does not touch /opt/trellis, ~/gen3d, ~/voice or ~/audio (only READS nvcc from the trellis env to build CUDA extensions).
exec >> /mnt/d/omnissiah/.cache/gen3d/setup_rig.log 2>&1
set -x
mkdir -p ~/rig
export MAMBA_ROOT_PREFIX=$HOME/rig/mamba
date
if [ ! -x $HOME/rig/env/bin/python ]; then
  micromamba create -y -p $HOME/rig/env -c conda-forge python=3.11 pip
fi
PY=$HOME/rig/env/bin/python
$PY -m pip install --upgrade pip
$PY -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
$PY -m pip install "numpy==1.26.4" scipy pillow trimesh networkx rtree pygltflib huggingface_hub safetensors \
    "transformers==4.51.3" python-box einops omegaconf pytorch_lightning lightning addict timm fast-simplification psutil
$PY -m pip install bpy==4.2.0 || echo "BPY_INSTALL_FAILED"
$PY -m pip install spconv-cu126 || echo "SPCONV_INSTALL_FAILED"
$PY -m pip install torch_scatter torch_cluster -f https://data.pyg.org/whl/torch-2.7.0+cu128.html --no-cache-dir || echo "PYG_INSTALL_FAILED"
$PY -m pip install "numpy==1.26.4"
$PY -m pip list 2>/dev/null | grep -i -E "torch|spconv|cumm|bpy|numpy|transformers|trimesh|scatter|cluster"
$PY -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
date
echo SETUP_DONE
