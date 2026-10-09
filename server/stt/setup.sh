#!/bin/bash
# Recreates the GPU speech-recognition environment inside WSL Ubuntu: ~/stt/env (faster-whisper / CTranslate2 + pip CUDA libs).
# Does not touch ~/voice or any other worker. Log: /mnt/d/omnissiah/.cache/stt/setup.log
mkdir -p /mnt/d/omnissiah/.cache/stt ~/stt
exec > /mnt/d/omnissiah/.cache/stt/setup.log 2>&1
set -x
date
# python 3.11 from the voice worker's conda env is used only as the interpreter for a fresh venv (system python is 3.14).
BASEPY=${BASEPY:-$HOME/voice/env/bin/python}
[ -x "$BASEPY" ] || BASEPY=$(command -v python3.11 || command -v python3)
if [ ! -x "$HOME/stt/env/bin/python" ]; then
  "$BASEPY" -m venv "$HOME/stt/env" || exit 1
fi
PY=$HOME/stt/env/bin/python
$PY -m pip install --upgrade pip
$PY -m pip install faster-whisper numpy scipy nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
$PY -m pip list | grep -i -E "faster|ctranslate|nvidia|numpy|scipy|av |onnxruntime"
cp /mnt/d/omnissiah/server/stt/worker.py "$HOME/stt/worker.py" 2>/dev/null
echo SETUP_DONE
date
