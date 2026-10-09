#!/bin/bash
# Starts the travel worker (HTTP on localhost) inside WSL. Usage: start_worker.sh [--port N] [--idle S] [--host H] ...
# Logs go to <root>/.cache/travel/worker.log (+ pano.log for the model process).
ROOT=/mnt/d/omnissiah
mkdir -p "$ROOT/.cache/travel"
exec "$HOME/travel/venv/bin/python" -u "$ROOT/server/travel/worker.py" --root "$ROOT" "$@" >> "$ROOT/.cache/travel/worker.stdout.log" 2>&1
