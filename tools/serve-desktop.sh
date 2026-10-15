#!/bin/sh
# Serves the source checkout for a desktop browser:
#   http://localhost:8741/debug.html
set -e
cd "$(dirname "$0")/.."
exec python3 -m http.server "${PORT:-8741}"
