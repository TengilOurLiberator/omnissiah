#!/bin/bash
# Installs the text->music environment (ACE-Step 1.5, MIT) under ~/audio.
# Own env: ~/audio/ace (python 3.12, torch 2.10.0+cu128). The ACE-Step source tree lives in ~/audio/src/ACE-Step-1.5
# and is used through PYTHONPATH (not pip-installed). We skip gradio / fastapi / nano-vllm: only the DiT is used
# (the 5Hz language model is not needed for instrumental loops and costs VRAM + minutes).
mkdir -p /mnt/d/omnissiah/.cache/audio
exec > /mnt/d/omnissiah/.cache/audio/setup_ace.log 2>&1
set -x
date
mkdir -p ~/audio/src
export MAMBA_ROOT_PREFIX=$HOME/audio/mamba
[ -d ~/audio/ace ] || micromamba create -y -p $HOME/audio/ace -c conda-forge python=3.12 pip
PY=$HOME/audio/ace/bin/python
$PY -m pip install --upgrade pip
$PY -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 torch==2.10.0+cu128 torchaudio==2.10.0+cu128 torchvision==0.25.0+cu128
$PY -m pip install "transformers>=4.51.0,<4.58.0" diffusers scipy soundfile loguru "einops>=0.8.1" "accelerate>=1.12.0" \
  numba "vector-quantize-pytorch>=1.27.15" "torchcodec>=0.9.1" "torchao>=0.16.0,<0.17.0" toml safetensors huggingface_hub \
  diskcache xxhash "setuptools<72" pytorch-wavelets pywavelets peft lycoris-lora lightning modelscope matplotlib typer-slim \
  pyloudnorm av
$PY -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
date
echo SETUP_DONE
