#!/bin/bash
# Syntax-checks every python and shell file in server/voice.
cd /mnt/d/omnissiah/server/voice
for f in *.py; do
  ~/voice/env/bin/python - "$f" <<'EOF' && echo "ok $f"
import ast, sys
ast.parse(open(sys.argv[1], encoding="utf-8").read())
EOF
done
for s in *.sh; do bash -n "$s" && echo "ok $s"; done
