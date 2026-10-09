#!/bin/bash
# Starts the GPU speech worker inside WSL. Usage: start_worker.sh [--port N] [--host H] [--idle S]
# Logs: <root>/.cache/stt/worker.stdout.log
ROOT=/mnt/d/omnissiah
mkdir -p "$ROOT/.cache/stt"
ENV=$HOME/stt/env
SP=$(echo "$ENV"/lib/python3*/site-packages)
export LD_LIBRARY_PATH="$SP/nvidia/cublas/lib:$SP/nvidia/cudnn/lib:$SP/nvidia/cuda_runtime/lib:$SP/nvidia/cuda_nvrtc/lib:$LD_LIBRARY_PATH"
export HF_HOME="$HOME/stt/hf"
export PYTHONWARNINGS=ignore
export TOKENIZERS_PARALLELISM=false
exec "$ENV/bin/python" -u "$ROOT/server/stt/worker.py" "$@" >> "$ROOT/.cache/stt/worker.stdout.log" 2>&1
