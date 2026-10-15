#!/bin/bash
# Builds the minified app (enyo deploy, like org.webosports.app.memos) and
# packs it as deploy/<id>_<version>_all.ipk: an ar archive with
# debian-binary, control.tar.gz and data.tar.gz installing to
# usr/palm/applications/<id>/. No palm-package or SDK needed.
set -e
cd "$(dirname "$0")/.."

ID=$(node -p 'require("./appinfo.json").id')
VERSION=$(node -p 'require("./appinfo.json").version')
TITLE=$(node -p 'require("./appinfo.json").title')
MAINTAINER=$(node -p 'require("./appinfo.json").maintainer')

node tools/tests/data-tests.js >/dev/null

rm -rf "deploy/$ID"
node enyo/tools/deploy.js -o "deploy/$ID" >/dev/null

WORK=deploy/ipk
rm -rf "$WORK"
mkdir -p "$WORK/control" "$WORK/data/usr/palm/applications"
cp -r "deploy/$ID" "$WORK/data/usr/palm/applications/$ID"

SIZE=$(du -sk "$WORK/data" | cut -f1)
cat > "$WORK/control/control" <<CONTROL
Package: $ID
Version: $VERSION
Section: misc
Priority: optional
Architecture: all
Installed-Size: $SIZE
Maintainer: $MAINTAINER
Description: $TITLE
 Weather forecasts from Open-Meteo, based on Dash Weather+ by Garrett Downs.
webOS-Package-Format-Version: 2
webOS-Packager-Version: x.y.x
CONTROL

echo "2.0" > "$WORK/debian-binary"
TAROPTS="--owner=0 --group=0 --numeric-owner --sort=name"
tar $TAROPTS -czf "$WORK/control.tar.gz" -C "$WORK/control" ./control
tar $TAROPTS -czf "$WORK/data.tar.gz" -C "$WORK/data" ./usr

OUT="deploy/${ID}_${VERSION}_all.ipk"
rm -f "$OUT"
(cd "$WORK" && ar rc "../$(basename "$OUT")" debian-binary control.tar.gz data.tar.gz)
echo "$OUT"
