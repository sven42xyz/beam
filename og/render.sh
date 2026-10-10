#!/bin/sh
# Rendert og/og.html als 1200×630-PNG pro Sprache nach public/.
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
for lang in de en; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --screenshot="public/og-$lang.png" \
    "file://$PWD/og/og.html?lang=$lang" >/dev/null 2>&1
  echo "public/og-$lang.png"
done
