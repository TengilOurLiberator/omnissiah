#!/bin/bash
# Starts the voice worker (HTTP on localhost) inside WSL. Usage: start_worker.sh [--port N] [--host H] [--idle S] [--warm]
# Logs: <root>/.cache/voice/worker.stdout.log
ROOT=/mnt/d/omnissiah
mkdir -p "$ROOT/.cache/voice"
export HF_HOME="$HOME/voice/hf"
export PYTHONWARNINGS=ignore
export TOKENIZERS_PARALLELISM=false
exec "$HOME/voice/env/bin/python" -u "$ROOT/server/voice/worker.py" --root "$ROOT" "$@" >> "$ROOT/.cache/voice/worker.stdout.log" 2>&1
