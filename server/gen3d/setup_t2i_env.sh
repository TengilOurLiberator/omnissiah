#!/bin/bash
exec > /mnt/d/omnissiah/.cache/gen3d/setup_t2i.log 2>&1
set -x
mkdir -p ~/gen3d
export MAMBA_ROOT_PREFIX=$HOME/gen3d/mamba
date
micromamba create -y -p $HOME/gen3d/env -c conda-forge python=3.12 pip
PY=$HOME/gen3d/env/bin/python
$PY -m pip install --upgrade pip
$PY -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
$PY -m pip install "diffusers>=0.36" transformers accelerate safetensors sentencepiece protobuf pillow numpy huggingface_hub
$PY -m pip list | grep -i -E "torch|diffusers|transformers|accelerate|huggingface"
$PY -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
date
echo SETUP_DONE