/*
	Desktop smoke test: boots debug.html in headless Chromium with the
	browser's location faked to Utrecht, drives the real views against the
	live Open-Meteo / Nominatim APIs (panels, place search, units), fails
	on any page error, and saves a screenshot per step.

		tools/serve-desktop.sh &          # port 8741
		node tools/tests/smoke.js [outdir]

	Needs Node 22+ (global WebSocket/fetch) and chromium on PATH (or $CHROME).
*/
var spawn = require("child_process").spawn;
var fs = require("fs");
var path = require("path");

var outDir = process.argv[2] || path.join(__dirname, "..", "..", "build", "smoke");
var chrome = process.env.CHROME || "chromium";
var url = "http://localhost:" + (process.env.PORT || 8741) + "/debug.html";
var port = +(process.env.DEBUG_PORT || 9342);

fs.mkdirSync(outDir, {recursive: true});

var steps = [
	["currently", "1"],
	["hourly", "weatherApp.$.panels.setIndex(2);"],
	["daily", "weatherApp.$.panels.setIndex(3);"],
	["menu", "weatherApp.$.panels.setIndex(4);"],
	["search", "weatherApp.addPlaceTapped(); weatherApp.$.searchInput.setValue('Tromso'); weatherApp.searchPlaces();"],
	["added-place", "weatherApp.addSearchResult({index: 0});"],
	["imperial", "weatherApp.$.prefUnitsPick.setSelected(weatherApp.$.optImperial); weatherApp.prefChanged();"],
	["back-to-gps", "weatherApp.$.panels.setIndex(4); weatherApp.selectLocation({index: 0});"],
	["metric-again", "weatherApp.$.prefUnitsPick.setSelected(weatherApp.$.optAuto); weatherApp.prefChanged();"],
	["remove-place", "weatherApp.$.panels.setIndex(4); weatherApp.removeLocation({index: 1});"],
	["back-gesture", "weatherApp.backGesture(null, {});"]
];

// SMOKE_STEPS=file.json overrides the walk-through with [[name, js], ...] for debugging.
if (process.env.SMOKE_STEPS) {
	steps = JSON.parse(fs.readFileSync(process.env.SMOKE_STEPS, "utf8"));
}

var proc = spawn(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--window-size=480,800",
	"--remote-debugging-port=" + port, "about:blank"], {stdio: "ignore"});

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function main() {
	var target;
	for (var i = 0; i < 50 && !target; i++) {
		await sleep(200);
		try {
			// Own tab, so a browser someone else started on this port is left alone.
			target = await (await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", {method: "PUT"})).json();
		} catch (e) {}
	}
	if (!target) {
		throw new Error("chromium did not start");
	}
	var ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise(function(r) { ws.onopen = r; });
	var id = 0, pending = {}, errors = [];
	ws.onmessage = function(m) {
		var msg = JSON.parse(m.data);
		if (msg.id && pending[msg.id]) {
			pending[msg.id](msg);
			delete pending[msg.id];
		} else if (msg.method === "Runtime.exceptionThrown") {
			errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
		} else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
			errors.push(msg.params.args.map(function(a) { return a.value || a.description; }).join(" "));
		}
	};
	function send(method, params) {
		return new Promise(function(r) {
			pending[++id] = r;
			ws.send(JSON.stringify({id: id, method: method, params: params || {}}));
		});
	}
	await send("Runtime.enable");
	await send("Page.enable");
	await send("Browser.grantPermissions", {permissions: ["geolocation"]});
	await send("Emulation.setGeolocationOverride", {latitude: 52.0907, longitude: 5.1214, accuracy: 50});
	await send("Page.navigate", {url: url});
	await sleep(6000);

	var failed = 0;
	for (var s = 0; s < steps.length; s++) {
		var name = steps[s][0];
		var res = await send("Runtime.evaluate", {expression: "(function(){" + steps[s][1] + ";})()", returnByValue: true});
		await sleep(3500);
		var shot = await send("Page.captureScreenshot", {format: "png"});
		var file = path.join(outDir, (s + 1 < 10 ? "0" : "") + (s + 1) + "-" + name + ".png");
		fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
		var ex = res.result && res.result.exceptionDetails;
		if (ex || errors.length) {
			failed++;
			console.log("FAIL " + name + ": " + (ex ? (ex.exception && ex.exception.description) || ex.text : errors.join("; ")));
			errors = [];
		} else {
			console.log("ok   " + name + "  " + file + (process.env.SMOKE_STEPS ? "  => " + JSON.stringify(res.result.result.value) : ""));
		}
	}
	ws.close();
	await fetch("http://127.0.0.1:" + port + "/json/close/" + target.id).catch(function() {});
	proc.kill();
	process.exit(failed ? 1 : 0);
}

main().catch(function(e) {
	console.error(e);
	proc.kill();
	process.exit(1);
});
