#!/bin/bash
# Prints what the shared gen3d python env offers (read only).
PY=$HOME/gen3d/env/bin/python
$PY - <<'EOF'
import diffusers, transformers, torch
print("diffusers", diffusers.__version__, "transformers", transformers.__version__, "torch", torch.__version__)
for n in ("Flux2KleinPipeline", "QwenImageEditPlusPipeline", "Flux2Pipeline"):
    try:
        getattr(__import__("diffusers"), n); print(n, "ok")
    except Exception as e:
        print(n, "MISSING", type(e).__name__)
EOF
$HOME/gen3d/env/bin/pip list 2>/dev/null | grep -i -E 'accelerate|safetensors|bitsandbytes|optimum|gguf|sentencepiece|pillow|numpy|scipy|opencv|huggingface|torchao|peft'
ls ~/travel
df -h ~ | tail -1
