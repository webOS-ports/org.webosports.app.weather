/*
	On-device tests: the installed app in the real WAM on a LuneOS device,
	with the real location, settings and network. Run through
	tools/test-device.sh, which installs and launches the app and forwards
	WAM's DevTools port; or by hand:

		DEVICE_DEBUG=http://127.0.0.1:19998 DEVICE_NAME=q25 node tools/tests/device-tests.js

	Every device has its own screen, so each run records the viewport and
	pixel ratio and checks the layout at that size, including the widget at
	the dashboard height the shell really gives it. The app's settings and
	places are saved first and restored at the end.

	Screenshots go to test-output/device/<name>/.
*/
var path = require("path");
var execFile = require("child_process").execFile;
var t = require("./lib/harness.js");
var device = require("./lib/device.js");
var assert = t.assert;

var base = process.env.DEVICE_DEBUG || "http://127.0.0.1:19998";
var name = process.env.DEVICE_NAME || "device";
var outDir = path.join(__dirname, "..", "..", "test-output", "device", name);
var APP = /org\.webosports\.app\.weather\/index\.html/;
var WIDGET = /org\.webosports\.app\.weather\/widget\.html/;
var PREFS_KEY = "org.webosports.app.weather.prefs";

var page, savedPrefs, info;

function shot(inPage, inName) {
	return inPage.screenshot(path.join(outDir, inName + ".png"));
}

//* Bounding boxes of the things that went wrong on narrow screens before.
function layout(inPage) {
	return inPage.eval("(function(){var a=weatherApp;" +
		"var box=a.$.statusLine1.hasNode().parentNode.getBoundingClientRect();" +
		"var l1=a.$.statusLine1.hasNode();" +
		"return {right:Math.round(box.right),width:innerWidth,clipped:l1.scrollWidth>l1.clientWidth+1," +
		"docWidth:document.documentElement.scrollWidth};})()");
}

t.test("device and screen", async function() {
	info = await page.eval("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screen:screen.width+'x'+screen.height," +
		"ua:navigator.userAgent.replace(/^.*?Chrome\\/([0-9.]+).*$/,'Chrome $1'),lang:navigator.language,palm:!!window.PalmSystem})");
	console.log("     " + name + ": " + info.width + "x" + info.height + " CSS px, devicePixelRatio " + info.dpr +
		", screen " + info.screen + ", " + info.ua + ", " + info.lang);
	assert.ok(info.palm, "not running under WAM (no PalmSystem)");
});

t.test("device can reach the weather service, with a sane clock", async function() {
	// A device without a connection or with a clock far off (TLS) fails
	// everything after this for reasons that are not the app's.
	var r = await page.eval("new Promise(function(res){var x=new XMLHttpRequest();" +
		"x.open('GET','https://api.open-meteo.com/v1/forecast?latitude=52&longitude=5&current=temperature_2m');" +
		"x.onreadystatechange=function(){if(x.readyState===4)res({status:x.status,online:navigator.onLine,now:Date.now()});};" +
		"x.send();setTimeout(function(){res({status:-1,online:navigator.onLine,now:Date.now()});},20000);})");
	var skewMin = Math.round((r.now - Date.now()) / 60000);
	console.log("     network " + (r.status === 200 ? "ok" : "FAILED (status " + r.status + ", navigator.onLine " + r.online + ")") +
		", device clock " + (Math.abs(skewMin) < 5 ? "ok" : "off by " + skewMin + " min"));
	assert.ok(Math.abs(skewMin) < 24 * 60, "device clock is off by " + skewMin + " minutes; set the time (TLS fails)");
	assert.strictEqual(r.status, 200, "device cannot reach api.open-meteo.com; connect it to Wi-Fi");
});

t.test("boots without errors and gets a forecast from the real services", async function() {
	await page.reload();
	await page.waitFor("window.weatherApp && weatherApp.hasNode()", 30000);
	// A GPS fix indoors can take a while or never come; the app then says so.
	var feeder = null;
	if (process.env.MOCK_LOCATION && process.env.DEVICE_SERIAL) {
		// The location service takes a mocked fix only while a request is
		// running ("Location determination was not started" otherwise), so
		// keep offering it until the app has asked.
		var ll = process.env.MOCK_LOCATION.split(",");
		var body = JSON.stringify({name: "gps", location: {latitude: +ll[0], longitude: +ll[1]}});
		console.log("     feeding the location service a mocked GPS fix: " + process.env.MOCK_LOCATION);
		feeder = setInterval(function() {
			execFile("adb", ["-s", process.env.DEVICE_SERIAL, "shell",
				"luna-send -w 3000 -n 1 luna://com.webos.service.location/mock/setLocation '" + body + "' > /dev/null 2>&1"], function() {});
		}, 1500);
	}
	var outcome;
	try {
		outcome = await page.waitFor("weatherApp.lastJson && !weatherApp.loading ? 'forecast' : " +
			"(weatherApp.$.statusLine2.content === 'Location unavailable' ? 'nolocation' : " +
			"(!weatherApp.loading && weatherApp.$.sysWarning.showing ? 'warning: ' + weatherApp.$.sysWarning.content : null))", 90000);
	} finally {
		clearInterval(feeder);
	}
	// Location worked but the forecast did not (offline, server error): say what the app said.
	assert.ok(!/^warning/.test(outcome), outcome);
	if (outcome === "nolocation" && process.env.MOCK_LOCATION) {
		assert.fail("the location service had a mocked position, but the app found none");
	}
	if (outcome === "nolocation") {
		console.log("     no location fix on this device; checking with a searched place instead");
		await page.eval("weatherApp.$.panels.setIndex(4); weatherApp.addPlaceTapped(); " +
			"weatherApp.$.searchInput.setValue('Utrecht'); weatherApp.searchPlaces()");
		await page.waitFor("document.querySelectorAll('.search-result').length > 0", 30000);
		await page.eval("weatherApp.addSearchResult({index: 0})");
		await page.waitFor("weatherApp.lastJson && !weatherApp.loading", 30000);
	}
	assert.ok(/^-?\d+°$/.test(await page.eval("weatherApp.$.currentTemp.hasNode().textContent")));
	await page.waitFor("weatherApp.$.statusLine1.content && weatherApp.$.statusLine1.content !== 'Current Location'", 20000);
	console.log("     place: " + await page.eval("weatherApp.$.statusLine1.content") + ", " +
		await page.eval("weatherApp.$.statusLine2.content") + ", " + await page.eval("weatherApp.$.statusLine3.content"));
	assert.deepStrictEqual(page.errors, []);
	await shot(page, "1-currently");
});

t.test("clock style comes from the system's timeFormat", async function() {
	var fmt = await page.waitFor("weatherApp.systemTimeFormat", 10000);
	var sunrise = await page.eval("weatherApp.$.eleSun.hasNode().textContent");
	console.log("     system timeFormat " + fmt + ", sunrise shown as " + sunrise);
	assert.ok(fmt === "HH24" ? /^\d\d:\d\d$/.test(sunrise) : /^\d{1,2}:\d\d(am|pm)$/.test(sunrise), sunrise);
});

t.test("layout fits this screen: header, no sideways scrolling", async function() {
	var r = await layout(page);
	assert.ok(r.right <= r.width, "status box overflows: " + JSON.stringify(r));
	assert.ok(!r.clipped, "place name clipped: " + JSON.stringify(r));
	assert.ok(r.docWidth <= r.width, "page scrolls sideways: " + JSON.stringify(r));
});

t.test("Hourly, Daily and Menu render at this size", async function() {
	var panels = [[2, "2-hourly", ".hour-box"], [3, "3-daily", ".day-box"], [4, "4-menu", ".settings-row"]];
	for (var i = 0; i < panels.length; i++) {
		await page.eval("weatherApp.$.panels.setIndex(" + panels[i][0] + ")");
		await device.sleep(800);
		assert.ok(await page.eval("document.querySelectorAll('" + panels[i][2] + "').length") > 0, panels[i][2]);
		var overflow = await page.eval("Array.prototype.filter.call(document.querySelectorAll('" + panels[i][2] + "'), function(e){" +
			"var r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1;}).length");
		assert.strictEqual(overflow, 0, panels[i][2] + " rows wider than the screen");
		await shot(page, panels[i][1]);
	}
	await page.eval("weatherApp.addPlaceTapped()");
	var w = await page.eval("weatherApp.$.searchInput.hasNode().getBoundingClientRect().width");
	assert.ok(w >= 150, "search field only " + w + "px");
	await page.eval("weatherApp.closeSearch(); weatherApp.$.panels.setIndex(1)");
});

async function checkWidget(inSize) {
	await page.eval("weatherApp.$.prefWidgetPick.setSelected(weatherApp.$.optWidget" + (inSize === "hourly" ? "Hourly" : "Compact") +
		"); weatherApp.widgetChanged()");
	var w = await device.attach(base, WIDGET, 20000);
	try {
		// WAM creates the window at card size and the shell then gives it the
		// dashboard height; measure after that, and fail if it never happens.
		await w.waitFor("innerHeight > 0 && innerHeight < 200", 15000);
		await w.waitFor("window.weatherWidget && /^-?\\d+°$/.test(weatherWidget.$.temp.hasNode().textContent)", 20000);
		var r = await w.eval("(function(){var s=document.querySelector('.widget-status').getBoundingClientRect();" +
			"var h=document.querySelector('.widget-hour-temp');var hb=h?h.getBoundingClientRect().bottom:0;" +
			"return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,statusRight:Math.round(s.right)," +
			"hoursBottom:Math.round(hb),docHeight:document.documentElement.scrollHeight,size:location.search};})()");
		console.log("     widget " + inSize + ": " + r.width + "x" + r.height + " CSS px (dpr " + r.dpr + ")");
		assert.ok(r.statusRight <= r.width, "widget text overflows: " + JSON.stringify(r));
		assert.ok(r.docHeight <= r.height + 1, "widget content taller than its dashboard: " + JSON.stringify(r));
		if (inSize === "hourly") {
			assert.ok(r.hoursBottom > 0 && r.hoursBottom <= r.height, "hourly strip cut off: " + JSON.stringify(r));
		}
		assert.deepStrictEqual(w.errors, []);
		await shot(w, "widget-" + inSize);
	} finally {
		w.close();
	}
}

t.test("widget: compact dashboard renders and fits", function() {
	return checkWidget("compact");
});

t.test("widget: hourly dashboard renders and fits", function() {
	return checkWidget("hourly");
});

t.test("widget: Off closes the dashboard window", async function() {
	await page.eval("weatherApp.$.prefWidgetPick.setSelected(weatherApp.$.optWidgetOff); weatherApp.widgetChanged()");
	var until = Date.now() + 10000, open = true;
	while (open && Date.now() < until) {
		open = (await device.targets(base)).some(function(x) { return WIDGET.test(x.url); });
		if (open) {
			await device.sleep(500);
		}
	}
	assert.ok(!open, "widget window still open");
	assert.deepStrictEqual(page.errors, []);
});

(async function() {
	page = await device.attach(base, APP, 30000);
	savedPrefs = await page.eval("localStorage.getItem('" + PREFS_KEY + "')");
	await t.run({
		after: async function() {
			// Put the device back the way it was: places, units, widget.
			try {
				await page.eval("(function(v){if(v===null){localStorage.removeItem('" + PREFS_KEY + "');}" +
					"else{localStorage.setItem('" + PREFS_KEY + "',v);}})(" + JSON.stringify(savedPrefs) + ")");
				await page.reload();
				console.log("     restored the app's own settings");
			} catch (e) {
				console.log("     could not restore settings: " + e.message);
			}
			page.close();
		}
	});
})().catch(function(e) {
	console.error(e);
	process.exit(1);
});
