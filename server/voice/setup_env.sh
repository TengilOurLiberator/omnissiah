#!/bin/bash
# Installs the voice worker environment inside WSL Ubuntu: ~/voice/env (python 3.11, torch 2.7.1+cu128, chatterbox-tts, kokoro).
# Does not touch /opt/trellis or ~/gen3d. Log: /mnt/d/omnissiah/.cache/voice/setup.log
mkdir -p /mnt/d/omnissiah/.cache/voice ~/voice
exec > /mnt/d/omnissiah/.cache/voice/setup.log 2>&1
set -x
date
export MAMBA_ROOT_PREFIX=$HOME/voice/mamba
if [ ! -x $HOME/voice/env/bin/python ]; then
  micromamba create -y -p $HOME/voice/env -c conda-forge python=3.11 pip git
fi
PY=$HOME/voice/env/bin/python
$PY -m pip install --upgrade pip
# torch 2.7.1+cu128 is the first line with Blackwell (sm_120) kernels; chatterbox pins 2.6.0 (cu124, no sm_120), so its deps are installed by hand.
$PY -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
$PY -m pip install "numpy<2" "librosa==0.11.0" s3tokenizer "transformers==5.2.0" "diffusers==0.29.0" "conformer==0.3.2" "safetensors==0.5.3" \
  pykakasi==2.3.0 pyloudnorm omegaconf resemble-perth huggingface_hub scipy soundfile einops tqdm
$PY -m pip install --no-deps chatterbox-tts==0.1.7
$PY -m pip install spacy-pkuseg || echo "spacy-pkuseg unavailable (only needed for Chinese)"
$PY -m pip list | grep -i -E "torch|chatterbox|transformers|diffusers|numpy|librosa|perth|s3tokenizer"
$PY -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
date
echo SETUP_DONE
