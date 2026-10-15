#!/bin/bash
# Installs the app on a LuneOS device over adb, launches it and runs
# tools/tests/device-tests.js against it in the real WAM.
#
#   tools/test-device.sh <adb-serial> [name] [--no-build]
#   MOCK_LOCATION=52.0907,5.1214 tools/test-device.sh ...
#
# MOCK_LOCATION has the device's location service report that GPS position
# (its mock/enable + mock/setLocation API), so the GPS path is tested
# indoors too. If the device has its GPS provider switched off (Settings),
# it is switched on for the run, since the service only takes a mocked fix
# from a running provider. The mock and the provider state are put back
# however the run ends.
#
# Install goes through com.webos.appInstallService (opkg with its own root,
# /media/cryptofs/apps), like Preware, so system packages are not touched.
# Screenshots: test-output/device/<name>/, plus compositor.png, the real
# screen including the notification area.
set -e
cd "$(dirname "$0")/.."
SERIAL="$1"
NAME="${2:-$SERIAL}"
[ -n "$SERIAL" ] || { echo "usage: $0 <adb-serial> [name] [--no-build]" >&2; exit 2; }
ID=$(node -p 'require("./appinfo.json").id')
VERSION=$(node -p 'require("./appinfo.json").version')
IPK="deploy/${ID}_${VERSION}_all.ipk"
ADB="adb -s $SERIAL"
PORT=$((19000 + RANDOM % 900))

case " $* " in
	*" --no-build "*) ;;
	*) tools/build-ipk.sh >/dev/null ;;
esac

echo "== $NAME: $($ADB shell getprop ro.product.device) / $($ADB shell uname -m)"
$ADB push "$IPK" /tmp/ >/dev/null
# luna-send prints nothing on an adb pipe; results go through a file.
$ADB shell "luna-send -w 90000 -i luna://com.webos.appInstallService/install '{\"id\":\"$ID\",\"ipkUrl\":\"/tmp/$(basename "$IPK")\",\"subscribe\":true}' > /tmp/inst.out 2>&1 & P=\$!; \
	for i in \$(seq 1 60); do sleep 1; grep -qE '\"installed\"|failed|errorCode' /tmp/inst.out && break; done; kill \$P 2>/dev/null; \
	rm -f /tmp/$(basename "$IPK"); grep -oE '\"state\":\"installed\"|errorText\":\"[^\"]*\"' /tmp/inst.out | tail -n 1"
$ADB shell "luna-send -w 20000 -n 1 luna://com.webos.service.applicationmanager/launch '{\"id\":\"$ID\"}' > /tmp/l.out 2>&1; cat /tmp/l.out"
echo
$ADB forward tcp:$PORT tcp:9998 >/dev/null
cleanup() {
	$ADB forward --remove tcp:$PORT >/dev/null 2>&1 || true
	if [ -n "$MOCK_LOCATION" ]; then
		$ADB shell "luna-send -w 5000 -n 1 luna://com.webos.service.location/mock/disable '{\"name\":\"gps\"}' > /tmp/m.out 2>&1" || true
		echo "location mock off: $($ADB shell cat /tmp/m.out)"
		if [ "$GPS_WAS_ON" = "false" ]; then
			$ADB shell "luna-send -w 5000 -n 1 luna://com.webos.service.location/setState '{\"Handler\":\"gps\",\"state\":false}' > /tmp/m.out 2>&1" || true
			echo "GPS provider switched back off: $($ADB shell cat /tmp/m.out)"
		fi
	fi
}
trap cleanup EXIT

if [ -n "$MOCK_LOCATION" ]; then
	$ADB shell "luna-send -w 5000 -n 1 luna://com.webos.service.location/getAllLocationHandlers '{}' > /tmp/m.out 2>&1"
	GPS_WAS_ON=$($ADB shell cat /tmp/m.out | grep -oE '"name": *"gps", *"state": *(true|false)' | grep -oE '(true|false)$')
	echo "GPS provider on: ${GPS_WAS_ON:-unknown}"
	if [ "$GPS_WAS_ON" = "false" ]; then
		$ADB shell "luna-send -w 5000 -n 1 luna://com.webos.service.location/setState '{\"Handler\":\"gps\",\"state\":true}' > /tmp/m.out 2>&1; cat /tmp/m.out"
		echo
	fi
	# The position itself is fed by device-tests.js while the app is asking.
	$ADB shell "luna-send -w 5000 -n 1 luna://com.webos.service.location/mock/enable '{\"name\":\"gps\"}' > /tmp/m.out 2>&1; cat /tmp/m.out"
	echo
fi

RC=0
DEVICE_SERIAL="$SERIAL" MOCK_LOCATION="$MOCK_LOCATION" DEVICE_DEBUG=http://127.0.0.1:$PORT DEVICE_NAME="$NAME" node tools/tests/device-tests.js || RC=$?

# The whole screen as the compositor draws it.
mkdir -p "test-output/device/$NAME"
$ADB shell "luna-send -w 10000 -n 1 luna://com.webos.surfacemanager/captureCompositorOutput '{\"output\":\"/tmp/weather-shot.png\",\"format\":\"PNG\"}' > /tmp/c.out 2>&1" || true
$ADB pull /tmp/weather-shot.png "test-output/device/$NAME/compositor.png" >/dev/null 2>&1 && \
	echo "screen: test-output/device/$NAME/compositor.png" || echo "(no compositor screenshot)"
$ADB shell rm -f /tmp/weather-shot.png
exit $RC
