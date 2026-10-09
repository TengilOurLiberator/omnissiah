#!/bin/bash
# Installs the text->sound-effect environment (MOSS-SoundEffect v2.0, Apache-2.0) under ~/audio.
# Own env: ~/audio/moss (python 3.12, torch 2.9.0+cu128). Never touches /opt/trellis, ~/gen3d or ~/voice.
mkdir -p /mnt/d/omnissiah/.cache/audio
exec > /mnt/d/omnissiah/.cache/audio/setup_moss.log 2>&1
set -x
date
mkdir -p ~/audio/src
export MAMBA_ROOT_PREFIX=$HOME/audio/mamba
[ -d ~/audio/moss ] || micromamba create -y -p $HOME/audio/moss -c conda-forge python=3.12 pip
PY=$HOME/audio/moss/bin/python
$PY -m pip install --upgrade pip
cd ~/audio/src/MOSS-TTS/moss_soundeffect_v2
# inference-only install (no gradio needed at runtime but it is pinned in the package; harmless)
$PY -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 -e ".[torch-cu128]"
$PY -m pip install pyloudnorm av scipy
$PY -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
date
echo SETUP_DONE
