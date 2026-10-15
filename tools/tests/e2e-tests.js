/*
	End-to-end tests: the real app (debug.html) in headless Chromium, with
	the webOS runtime, GPS and every web API answered by
	tools/tests/mock/webos-mock.js from tools/tests/fixtures/. Offline and
	deterministic; each test fails if a request would have left the machine.

		node tools/tests/e2e-tests.js [--screenshots] [--built]

	--built runs the same tests against the minified build in
	deploy/org.webosports.app.weather (tools/build-ipk.sh makes it), which
	is what ships.
		TEST_FILTER=search node tools/tests/e2e-tests.js

	Screenshots (with --screenshots, and always for a failing test) go to
	test-output/shots/.
*/
var fs = require("fs");
var path = require("path");
var t = require("./lib/harness.js");
var serverLib = require("./lib/server.js");
var browserLib = require("./lib/browser.js");
var assert = t.assert;

var root = path.join(__dirname, "..", "..");
var built = process.argv.indexOf("--built") >= 0;
var appRoot = built ? path.join(root, "deploy", "org.webosports.app.weather") : root;
var entry = built ? "/index.html" : "/debug.html";
var widgetEntry = built ? "/widget.html" : "/widget-debug.html";
var shotsDir = path.join(root, "test-output", "shots");
var wantShots = process.argv.indexOf("--screenshots") >= 0;
var mockSource = fs.readFileSync(path.join(__dirname, "mock", "webos-mock.js"), "utf8");

function fixture(inName) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", inName), "utf8"));
}

/**
	Luna permission groups from a real device (Q25), so the mock refuses
	exactly what ls-hubd would refuse for this app's requiredPermissions.
	Legacy com.palm.location has no ACG table on LuneOS (it exists only on
	old webOS), so it is exempt.
*/
var ACG = (function() {
	var dir = path.join(__dirname, "fixtures", "acg"), groups = {};
	fs.readdirSync(dir).forEach(function(inFile) {
		var j = JSON.parse(fs.readFileSync(path.join(dir, inFile), "utf8"));
		for (var g in j) {
			groups[g] = (groups[g] || []).concat(j[g]);
		}
	});
	return {groups: groups, granted: JSON.parse(fs.readFileSync(path.join(root, "appinfo.json"), "utf8")).requiredPermissions || [],
		exempt: ["^luna://com\\.palm\\.location/"]};
})();

var LOCATION = "luna://com.webos.service.location/getCachedPosition";
var UPDATES = "luna://com.webos.service.location/getLocationUpdates";
var PREFS = "luna://com.webos.service.systemservice/getPreferences";
var UTRECHT = {latitude: 52.0907, longitude: 5.1214, horizAccuracy: 30};

/**
	A scenario: the default is a LuneOS device in Utrecht with a 24-hour
	clock and a working network. Tests override pieces of it.
*/
function scenario(inOverrides) {
	var o = inOverrides || {};
	var luna = {};
	luna[LOCATION] = {json: UTRECHT};
	luna[PREFS] = {json: {timeFormat: "HH24"}};
	luna["luna://com.palm.applicationManager/launch"] = {json: {processId: "success"}};
	Object.assign(luna, o.luna || {});
		// Rules are anchored: "api.open-meteo.com" must not also catch
	// "geocoding-api.open-meteo.com".
	var http = (o.http || []).concat([
		{match: "^https://api\\.open-meteo\\.com/.*temperature_unit=fahrenheit", json: fixture("forecast-philadelphia-imperial.json")},
		{match: "^https://api\\.open-meteo\\.com/.*latitude=69\\.", json: fixture("forecast-tromso-metric.json")},
		{match: "^https://api\\.open-meteo\\.com/", json: fixture("forecast-utrecht-metric.json")},
		{match: "^https://geocoding-api\\.open-meteo\\.com/.*name=Tromso", json: fixture("geocode-tromso.json")},
		{match: "^https://geocoding-api\\.open-meteo\\.com/.*name=Utrecht", json: fixture("geocode-utrecht.json")},
		{match: "^https://geocoding-api\\.open-meteo\\.com/", json: {}},
		{match: "^https://nominatim\\.openstreetmap\\.org/search.*q=Tromso", json: fixture("nominatim-search-tromso.json")},
		{match: "^https://nominatim\\.openstreetmap\\.org/search", json: []},
		{match: "^https://nominatim\\.openstreetmap\\.org/reverse", json: fixture("reverse-utrecht.json")}
	]);
	return {
		webos: o.webos !== false,
		acg: o.acg || ACG,
		palmSystem: o.palmSystem || {},
		luna: luna,
		http: http,
		storage: {clear: o.keepStorage ? false : true, set: o.storage || {}}
	};
}

var server, browser, page, widgetPage, currentTest;

/**
	Opens the app under a scenario. Each call gets a fresh page, so storage
	is per test unless the scenario seeds it.
*/
async function open(inScenario, inViewport) {
	if (page) {
		await page.close();
	}
	if (widgetPage) {
		await widgetPage.close();
		widgetPage = null;
	}
	page = await newMockedPage(inScenario, inViewport);
	await page.goto(server.url + entry);
	await page.waitFor("window.weatherApp && weatherApp.hasNode()", 15000);
	return page;
}

function newMockedPage(inScenario, inViewport) {
	var vp = inViewport || {width: 480, height: 800};
	return browser.newPage({
		width: vp.width, height: vp.height,
		initScripts: ["window.__MOCK_CONFIG__ = " + JSON.stringify(inScenario) + ";", mockSource]
	});
}

/**
	Opens the widget in a tab of its own, beside the app's if one is open:
	same origin, so the two share localStorage and storage events, as the
	app card and its dashboard window do on the device.
*/
async function openWidget(inScenario, inSize, inViewport) {
	if (widgetPage) {
		await widgetPage.close();
	}
	widgetPage = await newMockedPage(inScenario, inViewport || {width: 480, height: inSize === "hourly" ? 120 : 52});
	await widgetPage.goto(server.url + widgetEntry + "?size=" + inSize);
	await widgetPage.waitFor("window.weatherWidget && weatherWidget.hasNode()", 15000);
	return widgetPage;
}

//* Waits until a forecast is on screen and nothing is loading.
function settled() {
	return page.waitFor("weatherApp.lastJson && !weatherApp.loading", 10000);
}

function text(inName) {
	return page.eval("weatherApp.$." + inName + ".hasNode() ? weatherApp.$." + inName + ".hasNode().textContent : null");
}

//* CSS selector for a named component, for real taps.
async function sel(inName) {
	var id = await page.eval("weatherApp.$." + inName + ".hasNode() && weatherApp.$." + inName + ".hasNode().id");
	assert.ok(id, "no node for " + inName);
	return "#" + id;
}

function calls(inKind, inPattern) {
	return page.eval("__MOCK__.calls.filter(function(c){return c.kind===" + JSON.stringify(inKind) +
		" && new RegExp(" + JSON.stringify(inPattern || "") + ").test(c.url);})");
}

async function panel(inIndex) {
	await page.eval("weatherApp.$.panels.setIndex(" + inIndex + ")");
	await page.waitFor("!weatherApp.$.panels.transitionPoints || weatherApp.$.panels.getIndex() === " + inIndex);
	await browserLib.sleep(400);
}

async function shot(inName) {
	if (wantShots) {
		await page.screenshot(path.join(shotsDir, inName.replace(/[^a-z0-9]+/gi, "-") + ".png"));
	}
}

// --- Start-up ------------------------------------------------------------

t.test("boots on LuneOS: location from luna, forecast, place name", async function() {
	await open(scenario());
	await settled();
	await page.waitFor("weatherApp.$.statusLine1.content === 'Utrecht'");
	assert.strictEqual(await text("currentTemp"), "14°");
	assert.strictEqual(await text("statusLine2"), "Overcast");
	assert.ok(/^Updated/.test(await text("statusLine3")), await text("statusLine3"));
	assert.strictEqual((await calls("luna", "getCachedPosition")).length, 1);
	assert.strictEqual((await calls("palm", "stageReady")).length, 1);
	var forecast = await calls("http", "api\\.open-meteo\\.com");
	assert.strictEqual(forecast.length, 1);
	assert.ok(/latitude=52\.0907&longitude=5\.1214/.test(forecast[0].url), forecast[0].url);
	assert.ok(!/fahrenheit/.test(forecast[0].url), "Utrecht must be metric: " + forecast[0].url);
	assert.strictEqual(await text("eleSun"), "08:02");
	await shot("boot-phone");
});

t.test("12-hour clock follows the system timeFormat (HH12)", async function() {
	var s = scenario();
	s.luna[PREFS] = {json: {timeFormat: "HH12"}};
	await open(s);
	await settled();
	assert.strictEqual(await text("eleSun"), "8:02am");
});

t.test("old webOS: the clock style comes from com.palm.systemservice", async function() {
	var luna = {};
	luna[PREFS] = {error: {errorCode: -1, errorText: "Unknown service"}};
	luna["luna://com.palm.systemservice/getPreferences"] = {json: {timeFormat: "HH12"}};
	var acg = JSON.parse(JSON.stringify(ACG));
	acg.exempt.push("^luna://com\\.palm\\.systemservice/");
	await open(scenario({luna: luna, acg: acg}));
	await settled();
	await page.waitFor("weatherApp.systemTimeFormat === 'HH12'");
	assert.strictEqual(await text("eleSun"), "8:02am");
});

t.test("without the systemsettings.query permission the clock style is refused, as on a device", async function() {
	var acg = JSON.parse(JSON.stringify(ACG));
	acg.granted = acg.granted.filter(function(g) { return g !== "systemsettings.query"; });
	await open(scenario({acg: acg}));
	await settled();
	var c = await page.eval("__MOCK__.calls.filter(function(c){return /systemservice\\/getPreferences/.test(c.url);})[0]");
	assert.ok(/^denied: needs one of systemsettings\.query/.test(c.acg), c.acg);
	assert.strictEqual(await page.eval("weatherApp.systemTimeFormat"), undefined);
	// The check under test, not a failure of this test: clear it for afterEach.
	await page.eval("__MOCK__.calls.forEach(function(c){ if (/^denied/.test(c.acg)) c.acg = 'expected-denial'; })");
});

t.test("the Time setting overrides the system clock style", async function() {
	await open(scenario());
	await settled();
	await page.eval("weatherApp.$.prefTimePick.setSelected(weatherApp.$.opt12hour); weatherApp.prefChanged()");
	assert.strictEqual(await text("eleSun"), "8:02am");
});

t.test("Your Hour says when rain starts, from the 15-minute data", async function() {
	var wet = fixture("forecast-utrecht-metric.json");
	wet.minutely_15.precipitation = [0, 0, 0, 0.4, 0.6, 0.2, 0, 0];
	await open(scenario({http: [{match: "^https://api\\.open-meteo\\.com/", json: wet}]}));
	await settled();
	assert.strictEqual(await text("yourHour"), "Rain starting in about 45 min.");
});

t.test("Hourly and Daily tabs list the whole forecast with day dividers", async function() {
	await open(scenario());
	await settled();
	var hours = await page.eval("WeatherData.model(weatherApp.lastJson, 'metric', true).hours.length");
	assert.strictEqual(await page.eval("document.querySelectorAll('.hour-box').length"), hours);
	assert.ok(await page.eval("document.querySelectorAll('.day-divider').length") >= 1);
	assert.strictEqual(await page.eval("document.querySelectorAll('.day-box').length"), 10);
	assert.strictEqual(await page.eval("document.querySelector('.day-box .date').textContent"), "Today");
	await panel(2);
	await shot("hourly");
	await panel(3);
	await shot("daily");
});

// --- Location ------------------------------------------------------------

t.test("no cached fix: the first live location update answers", async function() {
	var luna = {};
	luna[LOCATION] = {error: {errorCode: 2, errorText: "No cached position"}};
	luna[UPDATES] = {responses: [{json: {}}, {delay: 300, json: UTRECHT}]};
	await open(scenario({luna: luna}));
	await settled();
	assert.strictEqual((await calls("luna", "getLocationUpdates")).length, 1);
	assert.strictEqual(await text("currentTemp"), "14°");
});

t.test("legacy webOS: falls back to com.palm.location", async function() {
	var luna = {};
	luna[LOCATION] = {error: {errorCode: -1, errorText: "Unknown service"}};
	luna["luna://com.palm.location/getCurrentPosition"] = {json: UTRECHT};
	await open(scenario({luna: luna}));
	await settled();
	assert.strictEqual((await calls("luna", "com\\.palm\\.location/getCurrentPosition")).length, 1);
});

t.test("no location and nothing known: says so, asks no forecast", async function() {
	var luna = {};
	luna[LOCATION] = {error: {errorCode: 5, errorText: "Location service off"}};
	luna[UPDATES] = {error: {errorCode: 5, errorText: "Location service off"}};
	await open(scenario({luna: luna}));
	await page.waitFor("weatherApp.$.statusLine2.content === 'Location unavailable'");
	assert.ok(/add a place/.test(await text("sysWarning")), await text("sysWarning"));
	assert.strictEqual((await calls("http", "api\\.open-meteo\\.com")).length, 0);
});

t.test("location fails: the last known position is used", async function() {
	var luna = {};
	luna[LOCATION] = {error: {errorCode: 5, errorText: "Location service off"}};
	luna[UPDATES] = {error: {errorCode: 5, errorText: "Location service off"}};
	var prefs = {locs: [{gps: true, name: "Utrecht", detail: "", lat: 52.09, lon: 5.12, country: "NL"}], active: 0, firstUse: false};
	await open(scenario({luna: luna, storage: {"org.webosports.app.weather.prefs": prefs}}));
	await settled();
	assert.ok(/last known position/.test(await text("sysWarning")), await text("sysWarning"));
	assert.strictEqual(await text("currentTemp"), "14°");
});

// --- Offline / cache ------------------------------------------------------

t.test("offline: the cached forecast is shown with a warning", async function() {
	var prefs = {locs: [{gps: true, name: "Utrecht", detail: "", lat: 52.09, lon: 5.12, country: "NL"}], active: 0, firstUse: false};
	var forecasts = {gps: {time: Date.now() - 3 * 3600000, units: "metric", json: fixture("forecast-utrecht-metric.json")}};
	await open(scenario({
		http: [{match: ".", status: 0}],
		storage: {"org.webosports.app.weather.prefs": prefs, "org.webosports.app.weather.forecasts": forecasts}
	}));
	await page.waitFor("!weatherApp.loading && weatherApp.$.sysWarning.showing");
	assert.strictEqual(await text("currentTemp"), "14°");
	assert.ok(/No connection\. Showing the forecast from 3 h ago\./.test(await text("sysWarning")), await text("sysWarning"));
	assert.ok(/Updated 3 h ago/.test(await text("statusLine3")), await text("statusLine3"));
});

// --- Places ----------------------------------------------------------------

t.test("search with real taps: 'Tromso' finds Tromsø through the Nominatim fallback", async function() {
	await open(scenario());
	await settled();
	await panel(4);
	await page.tap(await sel("addButton"));
	await page.waitFor("weatherApp.$.searchRow.showing");
	await page.tap(await sel("searchInput"));
	await page.type("Tromso");
	await page.key("Enter");
	await page.waitFor("document.querySelectorAll('.search-result').length === 2");
	assert.strictEqual(await page.eval("document.querySelector('.search-result').textContent"), "TromsøTroms, Norway");
	assert.strictEqual((await calls("http", "nominatim\\.openstreetmap\\.org/search")).length, 1);
	await shot("search");
	await page.tap(".search-result");
	await page.waitFor("weatherApp.$.statusLine1.content === 'Tromsø'");
	await settled();
	var f = await calls("http", "api\\.open-meteo\\.com");
	assert.ok(/latitude=69\.65/.test(f[f.length - 1].url), f[f.length - 1].url);
	assert.strictEqual(await page.eval("weatherApp.$.panels.getIndex()"), 1);
	assert.strictEqual(await page.eval("weatherApp.prefs.locs.length"), 2);
});

t.test("Open-Meteo alone is enough when it finds three or more", async function() {
	await open(scenario());
	await settled();
	await panel(4);
	await page.eval("weatherApp.addPlaceTapped(); weatherApp.$.searchInput.setValue('Utrecht'); weatherApp.searchPlaces()");
	await page.waitFor("document.querySelectorAll('.search-result').length >= 3");
	assert.strictEqual((await calls("http", "nominatim\\.openstreetmap\\.org/search")).length, 0);
});

t.test("a saved place is removed with its × and the GPS place is kept", async function() {
	var prefs = {locs: [{gps: true, name: "Utrecht", detail: "", lat: 52.09, lon: 5.12, country: "NL"},
		{gps: false, name: "Tromsø", detail: "Troms, Norway", lat: 69.65, lon: 18.96, country: "NO"}], active: 1, firstUse: false};
	await open(scenario({storage: {"org.webosports.app.weather.prefs": prefs}}));
	await settled();
	await panel(4);
	assert.strictEqual(await page.eval("document.querySelectorAll('.location-remove').length"), 2);
	await page.tap(".location-row:nth-child(2) .location-remove");
	await page.waitFor("weatherApp.prefs.locs.length === 1");
	assert.strictEqual(await page.eval("weatherApp.prefs.active"), 0);
	assert.ok(await page.eval("JSON.parse(localStorage.getItem('org.webosports.app.weather.prefs')).locs.length === 1"));
});

t.test("place names from the network are shown as text, never as HTML", async function() {
	var evil = {results: [{name: "<img src=x onerror=window.__xss=1>", latitude: 1, longitude: 2, country: "<b>X</b>", country_code: "XX"},
		{name: "B", latitude: 3, longitude: 4}, {name: "C", latitude: 5, longitude: 6}]};
	await open(scenario({http: [{match: "geocoding-api", json: evil}]}));
	await settled();
	await panel(4);
	await page.eval("weatherApp.addPlaceTapped(); weatherApp.$.searchInput.setValue('evil'); weatherApp.searchPlaces()");
	await page.waitFor("document.querySelectorAll('.search-result').length === 3");
	await page.eval("weatherApp.addSearchResult({index: 0})");
	await browserLib.sleep(500);
	assert.strictEqual(await page.eval("document.querySelectorAll('.location-row img, .status-box img, .status-box b').length"), 0);
	assert.strictEqual(await page.eval("window.__xss"), undefined);
	assert.strictEqual(await text("statusLine1"), "<img src=x onerror=window.__xss=1>");
});

// --- Settings ----------------------------------------------------------------

t.test("Units: Imperial refetches in °F; Auto goes back to °C for Utrecht", async function() {
	await open(scenario());
	await settled();
	await page.eval("weatherApp.$.prefUnitsPick.setSelected(weatherApp.$.optImperial); weatherApp.prefChanged()");
	await page.waitFor("weatherApp.lastUnits === 'imperial' && !weatherApp.loading");
	assert.strictEqual(await text("currentTemp"), "79°");
	var f = await calls("http", "api\\.open-meteo\\.com");
	assert.ok(/temperature_unit=fahrenheit/.test(f[f.length - 1].url));
	await page.eval("weatherApp.$.prefUnitsPick.setSelected(weatherApp.$.optAuto); weatherApp.prefChanged()");
	await page.waitFor("weatherApp.lastUnits === 'metric' && !weatherApp.loading");
	assert.strictEqual(await text("currentTemp"), "14°");
});

t.test("settings survive a restart", async function() {
	await open(scenario());
	await settled();
	await page.eval("weatherApp.$.prefIconsPick.setSelected(weatherApp.$.optIconsWhite); weatherApp.prefChanged()");
	await page.reload();
	await page.waitFor("window.weatherApp && weatherApp.hasNode()");
	assert.strictEqual(await page.eval("weatherApp.prefs.icons"), "optIconsWhite");
	assert.ok(/optIconsWhite/.test(await page.eval("weatherApp.$.iconMain.hasNode().style.backgroundImage")));
});

// --- Navigation / lifecycle ------------------------------------------------

t.test("back (ESC) from Daily returns to Currently; from Currently it does nothing", async function() {
	await open(scenario());
	await settled();
	await panel(3);
	await page.key("Escape");
	await page.waitFor("weatherApp.$.panels.getIndex() === 1");
	await page.key("Escape");
	await browserLib.sleep(300);
	assert.strictEqual(await page.eval("weatherApp.$.panels.getIndex()"), 1);
});

t.test("relaunch refreshes only a stale forecast", async function() {
	await open(scenario());
	await settled();
	var before = (await calls("http", "api\\.open-meteo\\.com")).length;
	await page.eval("__MOCK__.relaunch({})");
	await browserLib.sleep(300);
	assert.strictEqual((await calls("http", "api\\.open-meteo\\.com")).length, before);
	await page.eval("weatherApp.loadedAt = Date.now() - 31 * 60000; __MOCK__.relaunch({})");
	await page.waitFor("__MOCK__.calls.filter(function(c){return /api\\.open-meteo/.test(c.url);}).length === " + (before + 1));
});

// --- Widget --------------------------------------------------------------------

function windows() {
	return page.eval("__MOCK__.calls.filter(function(c){return c.kind==='window';})");
}

var SEEDED = {
	"org.webosports.app.weather.prefs": {locs: [{gps: true, name: "Utrecht", detail: "", lat: 52.09, lon: 5.12, country: "NL"}],
		active: 0, firstUse: false, systemTimeFormat: "HH24"},
	"org.webosports.app.weather.forecasts": {gps: {time: Date.now(), units: "metric", json: fixture("forecast-utrecht-metric.json")}}
};

t.test("widget setting opens a LuneOS dashboard with the attributes the shell reads", async function() {
	await open(scenario());
	await settled();
	assert.deepStrictEqual(await windows(), [], "no widget unless asked for");
	await page.eval("weatherApp.$.prefWidgetPick.setSelected(weatherApp.$.optWidgetCompact); weatherApp.widgetChanged()");
	var w = await windows();
	assert.strictEqual(w.length, 1);
	assert.strictEqual(w[0].url, "widget.html?size=compact");
	// LuneOS_dashheight is matched in lower case by the shell; WAM keeps the case.
	assert.deepStrictEqual(w[0].attributes, {window: "dashboard", dashheight: 5.6, metrics: "units", icon: "assets/icon-30.png"});
	await page.eval("weatherApp.$.prefWidgetPick.setSelected(weatherApp.$.optWidgetHourly); weatherApp.widgetChanged()");
	w = await windows();
	assert.deepStrictEqual(w.map(function(c) { return c.url; }),
		["widget.html?size=compact", "close:widget.html?size=compact", "widget.html?size=hourly"]);
	assert.strictEqual(w[2].attributes.dashheight, 13);
	await page.eval("weatherApp.$.prefWidgetPick.setSelected(weatherApp.$.optWidgetOff); weatherApp.widgetChanged()");
	w = await windows();
	assert.strictEqual(w[w.length - 1].url, "close:widget.html?size=hourly");
	assert.strictEqual(await page.eval("weatherApp.prefs.widget"), "off");
});

t.test("widget reopens when the app starts and it was on", async function() {
	var prefs = JSON.parse(JSON.stringify(SEEDED["org.webosports.app.weather.prefs"]));
	prefs.widget = "hourly";
	await open(scenario({storage: {"org.webosports.app.weather.prefs": prefs}}));
	await settled();
	var w = await windows();
	assert.strictEqual(w.length, 1);
	assert.strictEqual(w[0].url, "widget.html?size=hourly");
	assert.strictEqual(await page.eval("weatherApp.$.prefWidgetPick.getSelected().value"), "hourly");
});

t.test("widget shows the app's cached forecast, with the hourly strip", async function() {
	var w = await openWidget(scenario({storage: SEEDED}), "hourly");
	await w.waitFor("weatherWidget.$.temp.hasNode().textContent === '14°'");
	assert.strictEqual(await w.eval("weatherWidget.$.place.hasNode().textContent"), "Utrecht");
	assert.ok(/^Overcast \d+° \/ \d+°$/.test(await w.eval("weatherWidget.$.status.hasNode().textContent")),
		await w.eval("weatherWidget.$.status.hasNode().textContent"));
	assert.strictEqual(await w.eval("document.querySelectorAll('.widget-hour').length"), 6);
	var fit = await w.eval("(function(){var t=document.querySelector('.widget-hour-temp').getBoundingClientRect();" +
		"return {bottom:t.bottom,h:innerHeight};})()");
	assert.ok(fit.bottom <= fit.h, "hourly temperatures cut off: " + JSON.stringify(fit));
	assert.ok(/^\d\d:00$/.test(await w.eval("document.querySelector('.widget-hour-time').textContent")));
	// Fresh cache: no network, and never the GPS.
	assert.strictEqual(await w.eval("__MOCK__.calls.filter(function(c){return c.kind==='http';}).length"), 0);
	assert.strictEqual(await w.eval("__MOCK__.calls.filter(function(c){return /location/.test(c.url);}).length"), 0);
	assert.deepStrictEqual(w.errors, []);
	if (wantShots) {
		await w.screenshot(path.join(shotsDir, "widget-hourly.png"));
	}
});

t.test("widget compact fits a standard dashboard row", async function() {
	var w = await openWidget(scenario({storage: SEEDED}), "compact", {width: 360, height: 52});
	await w.waitFor("weatherWidget.$.temp.hasNode().textContent === '14°'");
	assert.strictEqual(await w.eval("weatherWidget.$.hours.showing"), false);
	var r = await w.eval("(function(){var s=document.querySelector('.widget-status').getBoundingClientRect();" +
		"return {right:s.right,width:innerWidth,doc:document.documentElement.scrollHeight,h:innerHeight};})()");
	assert.ok(r.right <= r.width + 0.5, JSON.stringify(r));
	assert.ok(r.doc <= r.h, "widget taller than its dashboard: " + JSON.stringify(r));
	if (wantShots) {
		await w.screenshot(path.join(shotsDir, "widget-compact.png"));
	}
});

t.test("widget follows the app: a new place in the app shows up in the widget", async function() {
	await open(scenario({storage: SEEDED}));
	await settled();
	var w = await openWidget(scenario({keepStorage: true}), "compact");
	await w.waitFor("weatherWidget.$.place.hasNode().textContent === 'Utrecht'");
	await page.eval("weatherApp.$.panels.setIndex(4); weatherApp.addPlaceTapped(); weatherApp.$.searchInput.setValue('Tromso'); weatherApp.searchPlaces()");
	await page.waitFor("document.querySelectorAll('.search-result').length === 2");
	await page.eval("weatherApp.addSearchResult({index: 0})");
	await page.waitFor("weatherApp.$.statusLine1.content === 'Tromsø' && !weatherApp.loading");
	// The storage event, not a timer: well within the widget's 5-minute check.
	await w.waitFor("weatherWidget.$.place.hasNode().textContent === 'Tromsø'", 3000);
	assert.strictEqual(await w.eval("__MOCK__.calls.filter(function(c){return c.kind==='http';}).length"), 0);
});

t.test("widget refreshes a stale forecast by coordinates, never by GPS", async function() {
	var stale = JSON.parse(JSON.stringify(SEEDED));
	stale["org.webosports.app.weather.forecasts"].gps.time = Date.now() - 2 * 3600000;
	var w = await openWidget(scenario({storage: stale}), "compact");
	await w.waitFor("__MOCK__.calls.filter(function(c){return /api\\.open-meteo/.test(c.url);}).length === 1");
	await w.waitFor("!weatherWidget.loading");
	assert.ok(/latitude=52\.0900&longitude=5\.1200/.test(await w.eval("__MOCK__.calls.filter(function(c){return c.kind==='http';})[0].url")));
	assert.strictEqual(await w.eval("__MOCK__.calls.filter(function(c){return /location/.test(c.url);}).length"), 0);
	var saved = await w.eval("JSON.parse(localStorage.getItem('org.webosports.app.weather.forecasts')).gps.time");
	assert.ok(Date.now() - saved < 60000, "refreshed forecast stored for the app too");
});

t.test("widget: tap opens the app, tap on the icon only refreshes", async function() {
	var w = await openWidget(scenario({storage: SEEDED}), "compact");
	await w.waitFor("weatherWidget.$.temp.hasNode().textContent === '14°'");
	await w.tap(".widget-status");
	var launches = await w.eval("__MOCK__.calls.filter(function(c){return /applicationManager\\/launch/.test(c.url);})");
	assert.strictEqual(launches.length, 1);
	assert.strictEqual(launches[0].params.id, "org.webosports.app.weather");
	await w.tap(".widget-icon");
	await w.waitFor("__MOCK__.calls.filter(function(c){return /api\\.open-meteo/.test(c.url);}).length === 1");
	assert.strictEqual(await w.eval("__MOCK__.calls.filter(function(c){return /applicationManager\\/launch/.test(c.url);}).length"), 1);
});

t.test("widget shows place names as text", async function() {
	var evil = JSON.parse(JSON.stringify(SEEDED));
	evil["org.webosports.app.weather.prefs"].locs[0].name = "<img src=x onerror=window.__xss=1>";
	var w = await openWidget(scenario({storage: evil}), "compact");
	await w.waitFor("weatherWidget.$.temp.hasNode().textContent === '14°'");
	assert.strictEqual(await w.eval("document.querySelectorAll('.weather-widget img').length"), 0);
	assert.strictEqual(await w.eval("window.__xss"), undefined);
});

// --- Layout ------------------------------------------------------------------

async function checkLayout(inViewport) {
	await open(scenario(), inViewport);
	await settled();
	await page.waitFor("weatherApp.$.statusLine1.content === 'Utrecht'");
	var r = await page.eval("(function(){var b=weatherApp.$.statusLine1.hasNode().parentNode.getBoundingClientRect();" +
		"var l=weatherApp.$.statusLine1.hasNode();return {right:b.right,width:innerWidth,clipped:l.scrollWidth>l.clientWidth," +
		"docWidth:document.documentElement.scrollWidth};})()");
	assert.ok(r.right <= r.width + 0.5, "status box overflows the screen: " + JSON.stringify(r));
	assert.ok(!r.clipped, "place name is clipped: " + JSON.stringify(r));
	assert.ok(r.docWidth <= r.width, "page scrolls sideways: " + JSON.stringify(r));
	await panel(4);
	await page.eval("weatherApp.addPlaceTapped()");
	var w = await page.eval("weatherApp.$.searchInput.hasNode().getBoundingClientRect().width");
	assert.ok(w >= 150, "search field is only " + w + "px wide");
	await shot("menu-search-" + inViewport.width);
}

t.test("layout: phone (480x800) header fits and the search field is usable", function() {
	return checkLayout({width: 480, height: 800});
});

t.test("layout: small phone (360x640)", function() {
	return checkLayout({width: 360, height: 640});
});

t.test("layout: tablet (1024x768)", function() {
	return checkLayout({width: 1024, height: 768});
});

/**
	A scroller whose content is narrower or wider than itself gets
	horizontal room from ScrollMath and slides sideways under a diagonal
	drag (Preware's package details did, from padding on the scroller).
	Drag each tab's scroller diagonally and check its content never moves
	sideways, during the drag or after.
*/
async function checkNoSidewaysScroll(inViewport) {
	await open(scenario(), inViewport);
	await settled();
	var tabs = [[1, "currentlyContainer"], [2, "hourlyContainer"], [3, "dailyContainer"], [4, "menuContainer"]];
	for (var i = 0; i < tabs.length; i++) {
		await panel(tabs[i][0]);
		var name = tabs[i][1];
		var probe = "(function(){var s=weatherApp.$." + name + ";var c=s.$.strategy.$.client.hasNode();" +
			"var m=new WebKitCSSMatrix(getComputedStyle(c).transform);" +
			"return {x:Math.round(m.m41),y:Math.round(m.m42),left:s.getScrollLeft(),index:weatherApp.$.panels.getIndex()};})()";
		var box = await page.eval("(function(){var r=weatherApp.$." + name + ".hasNode().getBoundingClientRect();" +
			"return {x:r.left+r.width/2,y:r.top+r.height/2,h:r.height};})()");
		// Mostly up with some sideways, as a thumb does; too little sideways
		// to swipe the panels.
		await page.drag({x: box.x, y: box.y + box.h / 4}, {x: box.x - 40, y: box.y - box.h / 4}, 12, true);
		var during = await page.eval(probe);
		await page.release();
		await browserLib.sleep(600);
		var after = await page.eval(probe);
		console.log("     " + name + " during " + JSON.stringify(during) + " after " + JSON.stringify(after));
		assert.strictEqual(during.index, tabs[i][0], name + ": the drag swiped to another panel");
		assert.ok(during.x === 0 && during.left === 0, name + " slides sideways while dragging: " + JSON.stringify(during));
		assert.ok(after.x === 0 && after.left === 0, name + " left sideways after the drag: " + JSON.stringify(after));
	}
}

t.test("scrolling: tabs do not slide sideways under a diagonal drag (phone)", function() {
	return checkNoSidewaysScroll({width: 480, height: 800});
});

t.test("scrolling: tabs do not slide sideways under a diagonal drag (tablet)", function() {
	return checkNoSidewaysScroll({width: 1024, height: 768});
});

/**
	Touching a list while a flick still coasts must stop it where it is.
	Stock Enyo 2.5 TranslateScrollStrategy started the new drag from where
	the coast began and the list jumped back (fixed in enyo/, as in
	Preware and Memos).
*/
t.test("scrolling: touching a coasting list stops it in place, no snap-back", async function() {
	await open(scenario());
	await settled();
	await panel(2);
	// Where the list really is on screen: the first row's offset from the
	// scroller's top, whatever mix of translate and scrollTop moved it.
	var probe = "(function(){var s=weatherApp.$.hourlyContainer;var n=s.hasNode();" +
		"var row=n.querySelector('.hour-box');" +
		"return {shown:Math.round(n.getBoundingClientRect().top-row.getBoundingClientRect().top)," +
		"coasting:s.$.strategy.isScrolling()};})()";
	var box = await page.eval("(function(){var r=weatherApp.$.hourlyContainer.hasNode().getBoundingClientRect();" +
		"return {x:r.left+r.width/2,y:r.top+r.height/2,h:r.height};})()");
	// A quick flick up; while it still coasts, the finger goes down and
	// drags the list back 40px. The coast runs on for a few ms between the
	// probe and the touch, so the list may end a little further on, but it
	// must not jump back to where the coast began.
	await page.drag({x: box.x, y: box.y + box.h / 4}, {x: box.x, y: box.y - box.h / 4}, 4);
	await browserLib.sleep(150);
	var coast = await page.eval(probe);
	assert.ok(coast.coasting, "the flick did not coast: " + JSON.stringify(coast));
	await page.drag({x: box.x, y: box.y}, {x: box.x, y: box.y + 40}, 4, true);
	var dragged = await page.eval(probe);
	await page.release();
	console.log("     coasting at " + coast.shown + "px; after dragging back 40px at " + dragged.shown + "px");
	assert.ok(dragged.shown >= coast.shown - 60, "list jumped back from " + coast.shown + " to " + dragged.shown + "px");
});

// --- Run -----------------------------------------------------------------------

(async function() {
	if (built && !fs.existsSync(path.join(appRoot, "build", "app.js"))) {
		throw new Error("No build in " + appRoot + "; run tools/build-ipk.sh first");
	}
	server = await serverLib.start(appRoot);
	browser = await browserLib.launch();
	await t.run({
		beforeEach: function(inTest) {
			currentTest = inTest;
		},
		// Every test also fails on a page error or on a request the mock does
		// not know, so the tests themselves stay about behaviour.
		afterEach: async function() {
			if (!page) {
				return;
			}
			assert.deepStrictEqual(page.errors, [], "page errors");
			var unmocked = await page.eval("__MOCK__.calls.filter(function(c){return c.unmocked;}).map(function(c){return c.url;})");
			assert.deepStrictEqual(unmocked, [], "requests the mock does not answer");
			var refused = await page.eval("__MOCK__.calls.filter(function(c){return c.acg && /^(denied|unknown)/.test(c.acg);})" +
				".map(function(c){return c.url + ' (' + c.acg + ')';})");
			assert.deepStrictEqual(refused, [], "luna calls ls-hubd would refuse; check requiredPermissions in appinfo.json");
			if (widgetPage) {
				assert.deepStrictEqual(widgetPage.errors, [], "widget page errors");
				var unmockedW = await widgetPage.eval("__MOCK__.calls.filter(function(c){return c.unmocked;}).map(function(c){return c.url;})");
				assert.deepStrictEqual(unmockedW, [], "widget requests the mock does not answer");
				var refusedW = await widgetPage.eval("__MOCK__.calls.filter(function(c){return c.acg && /^(denied|unknown)/.test(c.acg);})" +
					".map(function(c){return c.url + ' (' + c.acg + ')';})");
				assert.deepStrictEqual(refusedW, [], "widget luna calls ls-hubd would refuse");
			}
		},
		onFailure: async function(inTest) {
			if (page) {
				var file = await page.screenshot(path.join(shotsDir, "FAIL-" + inTest.name.replace(/[^a-z0-9]+/gi, "-") + ".png"));
				console.log("     screenshot: " + path.relative(root, file));
				if (page.errors.length) {
					console.log("     page errors: " + page.errors.join(" | "));
				}
			}
		},
		after: async function() {
			if (widgetPage) {
				await widgetPage.close();
			}
			if (page) {
				await page.close();
			}
			await browser.close();
			await server.stop();
		}
	});
})().catch(function(e) {
	console.error(e);
	process.exit(1);
});

