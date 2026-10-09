#!/bin/bash
# Starts the gen3d worker (HTTP on localhost) inside WSL. Usage: start_worker.sh [--port N] [--idle S] [--host H] ...
# Logs go to <root>/.cache/gen3d/worker.log (+ t2i.log, trellis.log for the two model processes).
ROOT=/mnt/d/omnissiah
mkdir -p "$ROOT/.cache/gen3d"
exec "$HOME/gen3d/env/bin/python" -u "$ROOT/server/gen3d/worker.py" --root "$ROOT" "$@" >> "$ROOT/.cache/gen3d/worker.stdout.log" 2>&1