#!/bin/bash
# prints "used_mb,available_mb,swap_used_mb" of WSL (used by the resource sampler of the timing runs)
free -m | awk '/Mem:/{u=$3; a=$7} /Swap:/{s=$3} END{print u "," a "," s}'
