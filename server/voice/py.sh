#!/bin/bash
# Runs a script from server/voice with the voice env:  py.sh script.py [args]   (library noise / progress bars filtered)
export HF_HOME=$HOME/voice/hf
export PYTHONWARNINGS=ignore
cd /mnt/d/omnissiah/server/voice
$HOME/voice/env/bin/python -u "$@" 2>&1 | tr '\r' '\n' | grep -v -E "Warning|warn|deprecat|it/s|s/it|S3 Token|Fetching|^\s*$|self.gen|sdpa"
