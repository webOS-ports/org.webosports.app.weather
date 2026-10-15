/*
	Live smoke test against the real Open-Meteo and Nominatim services: no
	webOS mock, the browser's own geolocation faked to Utrecht. Catches API
	changes the fixtures cannot. Needs network; not part of the default run.

		node tools/tests/live-tests.js      (or tools/run-tests.sh --live)

	Keep it to a handful of requests: these are free services.
*/
var path = require("path");
var t = require("./lib/harness.js");
var serverLib = require("./lib/server.js");
var browserLib = require("./lib/browser.js");
var assert = t.assert;
var root = path.join(__dirname, "..", "..");
var server, browser, page;

t.test("live: forecast and place name for a GPS fix", async function() {
	page = await browser.newPage({width: 480, height: 800, geolocation: {latitude: 52.0907, longitude: 5.1214},
		initScripts: ["try{localStorage.clear()}catch(e){}"]});
	await page.goto(server.url + "/debug.html");
	await page.waitFor("window.weatherApp && weatherApp.lastJson && !weatherApp.loading", 30000);
	assert.ok(/^-?\d+°$/.test(await page.eval("weatherApp.$.currentTemp.hasNode().textContent")));
	await page.waitFor("weatherApp.$.statusLine1.content === 'Utrecht'", 15000);
	var m = await page.eval("WeatherData.model(weatherApp.lastJson, 'metric', true)");
	assert.strictEqual(m.days.length, 10);
	assert.ok(m.hours.length >= 24, "hours: " + m.hours.length);
	assert.ok(m.summary.hour && m.summary.day && m.summary.week);
	assert.deepStrictEqual(page.errors, []);
});

t.test("live: 'Tromso' finds Tromsø", async function() {
	await page.eval("weatherApp.$.panels.setIndex(4); weatherApp.addPlaceTapped(); " +
		"weatherApp.$.searchInput.setValue('Tromso'); weatherApp.searchPlaces()");
	await page.waitFor("document.querySelectorAll('.search-result').length > 0", 20000);
	var names = await page.eval("Array.prototype.map.call(document.querySelectorAll('.search-result'), function(e){return e.firstChild.textContent;})");
	assert.strictEqual(names[0], "Tromsø", JSON.stringify(names));
	assert.deepStrictEqual(page.errors, []);
});

(async function() {
	server = await serverLib.start(root);
	browser = await browserLib.launch();
	await t.run({after: async function() {
		if (page) {
			await page.close();
		}
		await browser.close();
		await server.stop();
	}});
})().catch(function(e) {
	console.error(e);
	process.exit(1);
});
