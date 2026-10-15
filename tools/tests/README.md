Tests
=====

    tools/run-tests.sh                 syntax/ES5 check, unit tests, mocked end-to-end tests
    tools/run-tests.sh --built         ... and the end-to-end tests again on the minified build
    tools/run-tests.sh --live          ... and a short run against the real web services
    tools/run-tests.sh --screenshots   save a screenshot per step to test-output/shots/
    TEST_FILTER=search tools/run-tests.sh

You need Node 22 or later (for its built-in `fetch` and `WebSocket`) and a
Chromium. The usual names are looked up on PATH; set `CHROME=` to use
another binary. Nothing comes from npm.

What runs
---------

| File | What it covers | Needs |
|---|---|---|
| `data-tests.js` | `source/WeatherData.js` against recorded API answers in `fixtures/` | Node |
| `e2e-tests.js` | the real app in headless Chromium, with webOS, GPS and network mocked | Node, Chromium |
| `live-tests.js` | two requests to the real Open-Meteo and Nominatim services | network |

The end-to-end tests are offline and deterministic. Every test also fails
when:
- the page throws an error or logs a `console.error`, or
- the app makes a request the mock has no answer for, so nothing reaches
  the internet unnoticed.

When a test fails, a screenshot of that moment is saved to
`test-output/shots/FAIL-<test>.png`.

The pieces
----------

- `lib/harness.js` is the test runner: `test(name, fn)` (fn may be async),
  then `run({beforeEach, afterEach, onFailure, after})`. It prints ok/FAIL
  and sets the exit code. A check in `afterEach` counts as part of the test.

- `lib/server.js` serves the checkout on a free port, so there is no
  dependency on python or on a server left running.

- `lib/browser.js` drives Chromium over the DevTools protocol.
  - Each run gets its own profile under `test-output/` and its own debugging
    port (`--remote-debugging-port=0`), so it never collides with another run
    or another tool's browser.
  - Page helpers:
    - `goto`, `reload`
    - `eval(expr)`: awaits promises
    - `waitFor(expr, ms)`: polls until truthy
    - `tap(selector)`: real mouse events, so enyo sees a tap
    - `drag(from, to, steps, hold)` / `release()`: a finger drag; with `hold` the
      finger stays down so a test can look mid-drag
    - `type(text)`, `key("Enter"|"Escape")`
    - `screenshot(file)`
    - `errors`
  - Page options:
    - `width`, `height`
    - `geolocation`: fake browser position
    - `locale`
    - `initScripts`: run before any page script

- `mock/webos-mock.js` is injected before the app loads, with a config
  in `window.__MOCK_CONFIG__`. The app itself is not changed for testing.
  - It fakes `PalmSystem` and `PalmServiceBridge`, so every
    `enyo.PalmService` / luna call is answered from `config.luna`.
  - It answers `XMLHttpRequest` to other hosts from `config.http`.
  - It seeds or clears `localStorage`.
  - It logs every call in `window.__MOCK__.calls`.
  - It can fire the webOS lifecycle: `__MOCK__.relaunch()`, `activate()`
    and `deactivate()`.

Mock config
-----------

```js
{
	webos: true,                      // false = plain browser, no PalmSystem
	palmSystem: {timeFormat: "HH12"}, // overrides for PalmSystem fields
	luna: {
		"luna://com.webos.service.location/getCachedPosition": {json: {latitude: 52.09, longitude: 5.12}},
		"luna://com.webos.service.location/getLocationUpdates": {responses: [{json: {}}, {delay: 300, json: {...}}]},
		"luna://com.palm.systemservice/getPreferences": {error: {errorCode: -1, errorText: "Unknown service"}}
	},
	http: [   // first match wins; anchor them ("^https://api\\.host/")
		{match: "^https://api\\.open-meteo\\.com/", json: {...}},
		{match: ".", status: 0}           // offline
	],
	storage: {clear: true, set: {"key": {...}}}
}
```

A rule answers with one of:
- `{json}`: success
- `{error}`: a luna failure
- `{status, json}`: an HTTP status; 0 means no connection
- `{responses: [...]}`: a subscription that answers several times

Add `{delay: ms}` to answer late, or `{never: true}` to never answer.

Storage is set up once per tab. A `reload()` keeps it, which is how "settings
survive a restart" is tested.

Writing a test
--------------

```js
t.test("offline: the cached forecast is shown with a warning", async function() {
	await open(scenario({http: [{match: ".", status: 0}], storage: {...}}));
	await page.waitFor("!weatherApp.loading && weatherApp.$.sysWarning.showing");
	assert.strictEqual(await text("currentTemp"), "14°");
});
```

`scenario()` is a LuneOS phone in Utrecht with a 24-hour clock and a working
network. Override only what the test is about.

Assert what the user sees (component text, element counts and sizes) and
what the app asked for (`calls("http", pattern)`, `calls("luna", pattern)`).
Do not assert internal state.

Check that a new test can fail. Break the behaviour it covers, see it fail,
then restore. The current tests were checked this way for three things:
HTML in place names, the Nominatim fallback and the relaunch staleness
check.

Recording fixtures
------------------

The fixtures are real answers, fetched with curl, for example:

    curl -s "$(node -p 'require("./source/WeatherData.js").forecastUrl(52.09, 5.12, "metric")')" \
        > tools/tests/fixtures/forecast-utrecht-metric.json

Use made-up data only for situations the real services don't produce on
demand, such as rain in the next hour, a polar night, or hostile place
names. Build it by changing a copy of a real answer inside the test.

Reusing this in another app
---------------------------

`lib/` and `mock/` know nothing about this app. Copy both into another web
app's `tools/tests/`. Then write that app's `e2e-tests.js`: a `scenario()`
with its luna services and hosts, an `open()` that loads its HTML entry
point, and its tests.

The mock answers whatever luna URIs and hosts it is given, so it works for
any app that reaches luna through `PalmServiceBridge`. webos-lib (Enyo 2)
and Enyo 1's `PalmService` both do; Enyo 1's is checked in
enyo-1.0-ports/framework/source/palm/services/bridge/. Enact's `LS2Request`
has not been checked.

On a device
-----------

    tools/test-device.sh <adb-serial> [name] [--no-build]
    MOCK_LOCATION=52.0907,5.1214 tools/test-device.sh <serial> q25

The script does the following:
1. Builds the ipk.
2. Installs it through `com.webos.appInstallService`. That runs opkg with
   its own root and database (`/media/cryptofs/apps`), so pending system
   packages, a kernel bootimg for example, are not touched.
3. Launches the app.
4. Forwards WAM's DevTools port (9998).
5. Runs `device-tests.js` against the real app, with the real luna
   services and the real network.

On each device the tests:
- record the viewport and pixel ratio
- check that the device has a network connection and a sane clock
- check boot, location and forecast, and the clock style from the system
  `timeFormat`
- check that the layout fits that screen
- check both widget sizes at the dashboard height the shell really gives
  them

The app's own settings are saved first and restored afterwards.
Screenshots go to `test-output/device/<name>/`. That includes
`compositor.png`, the whole screen as the shell draws it.

`MOCK_LOCATION` makes the device's location service report that position,
so the GPS path is tested indoors:
- The script turns on the service's mock (`mock/enable`).
- The test feeds it the fix (`mock/setLocation`) while the app is asking.
  The service refuses a fix while no request is running.
- If the GPS provider is switched off in Settings, it is switched on for
  the run.
- The mock and the provider state are put back afterwards.

The offline mock knows the device's luna permission groups.
`fixtures/acg/` holds `api-permissions.d` files pulled from a Q25. A luna
call the app has no `requiredPermissions` group for is denied, exactly as
ls-hubd does it, and the test fails. Pull more files from a device when the
app starts using another service.

Devices used so far (2026-10-14):

| Device | Screen | App viewport | Notes |
|---|---|---|---|
| Q25 (aarch64) | 720x720 | 450x380 CSS px, dpr 1 | timeFormat HH24; widget 440x56 (compact) and 440x130 (hourly) |
| Galaxy A3 2015 (armv7) | 540x960 | 450x800 CSS px, dpr 1 | timeFormat HH12; GPS provider off in Settings |
