#!/bin/bash
# Builds and copies the app onto a device over adb, then has the launcher
# pick it up.
set -e
cd "$(dirname "$0")/.."
ID=$(node -p 'require("./appinfo.json").id')
DEST=/usr/palm/applications/$ID

tools/build-ipk.sh >/dev/null
adb shell rm -rf "$DEST"
adb push "deploy/$ID" "$DEST"
adb shell luna-send -n 1 luna://com.palm.applicationManager/rescan {}
