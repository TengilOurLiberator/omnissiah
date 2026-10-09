#!/bin/bash
# Starts the blast worker (HTTP on localhost) inside WSL. Usage: start_worker.sh [--port N] [--idle S] [--host H] ...
# Logs: <root>/.cache/blast/worker.log (+ t2i.log, edit.log for the two model processes).
ROOT=/mnt/d/omnissiah
mkdir -p "$ROOT/.cache/blast"
exec "$HOME/blast/venv/bin/python" -u "$ROOT/server/blast/worker.py" --root "$ROOT" "$@" >> "$ROOT/.cache/blast/worker.stdout.log" 2>&1
