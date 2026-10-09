#!/bin/bash
# Starts the audio worker (HTTP on localhost) inside WSL. Usage: start_worker.sh [--port N] [--idle S] [--host H] ...
# Logs: <root>/.cache/audio/worker.log (+ sfx.log, music.log for the two model processes).
ROOT=/mnt/d/omnissiah
mkdir -p "$ROOT/.cache/audio"
exec "$HOME/audio/moss/bin/python" -u "$ROOT/server/audio/worker.py" --root "$ROOT" "$@" >> "$ROOT/.cache/audio/worker.stdout.log" 2>&1
