#!/bin/sh
# Runs the whole test suite:
#   1. syntax + ES5 check of source/ (the app must load in older engines too)
#   2. unit tests of the data layer          tools/tests/data-tests.js
#   3. end-to-end tests with mocks, offline  tools/tests/e2e-tests.js
#   4. with --built: build (tools/build-ipk.sh) and rerun step 3 on the
#      minified build that ships
#   5. with --live: a short run against the real services
#
#   tools/run-tests.sh [--built] [--live] [--screenshots]
#   TEST_FILTER=<regexp> tools/run-tests.sh      only matching tests
#   CHROME=/path/to/chromium tools/run-tests.sh
set -e
cd "$(dirname "$0")/.."
LIVE=0
BUILT=0
E2E_ARGS=""
for a in "$@"; do
	case "$a" in
		--live) LIVE=1 ;;
		--built) BUILT=1 ;;
		--screenshots) E2E_ARGS="--screenshots" ;;
		*) echo "unknown option: $a" >&2; exit 2 ;;
	esac
done

echo "== syntax / ES5"
for f in source/*.js; do node --check "$f"; done
# Arrow functions, let/const, template strings, classes: not in this codebase.
if grep -nE '=>|^\s*(let|const) |`|^\s*class ' source/*.js; then
	echo "ES2015+ syntax in source/ (see above)" >&2
	exit 1
fi
echo "ok"

echo "== unit tests"
node tools/tests/data-tests.js

echo "== end-to-end tests (mocked, offline)"
node tools/tests/e2e-tests.js $E2E_ARGS

if [ "$BUILT" = 1 ]; then
	echo "== build"
	tools/build-ipk.sh
	echo "== end-to-end tests on the minified build"
	node tools/tests/e2e-tests.js --built $E2E_ARGS
fi

if [ "$LIVE" = 1 ]; then
	echo "== live tests (network)"
	node tools/tests/live-tests.js
fi
