/*
	Tests for source/WeatherData.js, against recorded Open-Meteo, Open-Meteo
	geocoding and Nominatim answers (tools/tests/fixtures/) plus made-up
	cases for the summaries. Run with:

		node tools/tests/data-tests.js
*/
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var W = require("../../source/WeatherData.js");

function fixture(inName) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", inName), "utf8"));
}

var harness = require("./lib/harness.js");
var test = harness.test;

// --- URLs ----------------------------------------------------------------

test("forecastUrl: metric asks for nothing extra, local timezone", function() {
	var u = W.forecastUrl(52.0907, 5.1214, "metric");
	assert.ok(/latitude=52\.0907&longitude=5\.1214/.test(u), u);
	assert.ok(/timezone=auto/.test(u));
	assert.ok(!/fahrenheit/.test(u));
	assert.ok(/forecast_days=10/.test(u) && /forecast_hours=48/.test(u));
});

test("forecastUrl: imperial units", function() {
	var u = W.forecastUrl(39.95, -75.17, "imperial");
	assert.ok(/temperature_unit=fahrenheit/.test(u) && /wind_speed_unit=mph/.test(u) && /precipitation_unit=inch/.test(u), u);
});

test("search and reverse URLs are encoded", function() {
	assert.ok(/name='s-Hertogenbosch/.test(W.searchUrl("'s-Hertogenbosch", "nl")));
	assert.ok(/zoom=10/.test(W.reverseUrl(52.09, 5.12, "en")));
});

// --- Units / clock -------------------------------------------------------

test("resolveUnits: explicit, then the place's country only", function() {
	assert.strictEqual(W.resolveUnits("optMetric", "US"), "metric");
	assert.strictEqual(W.resolveUnits("optImperial", "NL"), "imperial");
	assert.strictEqual(W.resolveUnits("optAuto", "US"), "imperial");
	assert.strictEqual(W.resolveUnits("optAuto", "us"), "imperial");
	assert.strictEqual(W.resolveUnits("optAuto", "NL"), "metric");
	assert.strictEqual(W.resolveUnits("optAuto", ""), "metric");
});

test("resolve24h: explicit, system timeFormat, then locale", function() {
	assert.strictEqual(W.resolve24h("opt12hour", "HH24", "nl-NL"), false);
	assert.strictEqual(W.resolve24h("opt24hour", "HH12", "en-US"), true);
	assert.strictEqual(W.resolve24h("optAuto", "HH24", "en-US"), true);
	assert.strictEqual(W.resolve24h("optAuto", "HH12", "nl-NL"), false);
	assert.strictEqual(W.resolve24h("optAuto", undefined, "nl-NL"), true);
	assert.strictEqual(W.resolve24h("optAuto", undefined, "en-US"), false);
});

test("clock from local time strings, no device timezone involved", function() {
	assert.deepStrictEqual(W.clock("2026-10-14T08:02", true), {time: "08:02", suffix: ""});
	assert.deepStrictEqual(W.clock("2026-10-14T08:02", false), {time: "8:02", suffix: "am"});
	assert.deepStrictEqual(W.clock("2026-10-14T00:05", false), {time: "12:05", suffix: "am"});
	assert.deepStrictEqual(W.clock("2026-10-14T12:30", false), {time: "12:30", suffix: "pm"});
	assert.deepStrictEqual(W.clock("", true), {time: "", suffix: ""});
	assert.deepStrictEqual(W.hourLabel("2026-10-14T15:00", false), {time: "3", suffix: "pm"});
});

test("weekday and date labels", function() {
	assert.strictEqual(W.dayName("2026-10-14"), "Wednesday");
	assert.strictEqual(W.dateLabel("2026-10-14"), "Wednesday, October 14");
	assert.strictEqual(W.dayName("2026-12-31"), "Thursday");
});

test("wind direction and calm", function() {
	assert.strictEqual(W.windDirection(0, 10), "N");
	assert.strictEqual(W.windDirection(191, 8), "S");
	assert.strictEqual(W.windDirection(250, 8), "W");
	assert.strictEqual(W.windDirection(337, 8), "NW");
	assert.strictEqual(W.windDirection(359, 8), "N");
	assert.strictEqual(W.windDirection(90, 0.4), "Calm");
});

test("precipitation words, metric and imperial", function() {
	assert.strictEqual(W.precipWord(0, "metric"), "None");
	assert.strictEqual(W.precipWord(0.03, "metric"), "Sprinkling");
	assert.strictEqual(W.precipWord(0.3, "metric"), "Light");
	assert.strictEqual(W.precipWord(1.5, "metric"), "Moderate");
	assert.strictEqual(W.precipWord(4, "metric"), "Heavy");
	assert.strictEqual(W.precipWord(0.05, "imperial"), "Moderate");
});

test("visibility and pressure conversions", function() {
	assert.strictEqual(W.visibility(17800, "metric"), 18);
	assert.strictEqual(W.visibility(2400, "metric"), 2.4);
	assert.strictEqual(W.visibility(75131.232, "imperial"), 14);
	assert.strictEqual(W.pressure(1027.8, "metric"), 1028);
	assert.strictEqual(W.pressure(1011.4, "imperial"), 29.87);
});

// --- Conditions ----------------------------------------------------------

test("conditions: day/night variants, unknown code", function() {
	assert.deepStrictEqual(W.condition(0, 1), {icon: "clear-day", text: "Clear"});
	assert.deepStrictEqual(W.condition(2, 0), {icon: "partly-cloudy-night", text: "Partly cloudy"});
	assert.strictEqual(W.condition(65, 1).icon, "rain");
	assert.strictEqual(W.condition(67, 1).icon, "sleet");
	assert.strictEqual(W.condition(75, 1).icon, "snow");
	assert.strictEqual(W.condition(95, 1).text, "Thunderstorm");
	assert.strictEqual(W.condition(42, 1).icon, "na");
});

test("windy dry sky becomes the wind icon; wet weather keeps its icon", function() {
	assert.deepStrictEqual(W.condition(3, 1, 45, "metric"), {icon: "wind", text: "Windy, overcast"});
	assert.strictEqual(W.condition(3, 1, 25, "imperial").icon, "wind");
	assert.strictEqual(W.condition(3, 1, 20, "imperial").icon, "cloudy");
	assert.strictEqual(W.condition(63, 1, 60, "metric").icon, "rain");
});

test("background falls back for icons without a photo", function() {
	assert.strictEqual(W.background("wind"), "cloudy");
	assert.strictEqual(W.background("na"), "cloudy");
	assert.strictEqual(W.background("clear-night"), "clear-night");
});

// --- Summaries -----------------------------------------------------------

test("hour summary: rain starting, stopping, dry, steady", function() {
	var cur = {weather_code: 3, is_day: 1};
	assert.strictEqual(W.hourSummary({precipitation: [0, 0, 0.3, 0.5, 0, 0, 0, 0]}, cur, "metric"), "Rain starting in about 30 min.");
	assert.strictEqual(W.hourSummary({precipitation: [0.4, 0.2, 0, 0, 0, 0, 0, 0]}, {weather_code: 63}, "metric"), "Rain stopping in about 30 min.");
	assert.strictEqual(W.hourSummary({precipitation: [0, 0, 0, 0, 0, 0, 0, 0]}, cur, "metric"), "No precipitation for the next two hours.");
	assert.strictEqual(W.hourSummary({precipitation: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]}, {weather_code: 73}, "metric"), "Snow for the next two hours.");
	assert.strictEqual(W.hourSummary({precipitation: [0.05, 0, 0, 0]}, cur, "metric"), "No precipitation for the next hour.");
	assert.strictEqual(W.hourSummary(null, {weather_code: 2, is_day: 1}, "metric"), "Partly cloudy.");
});

function hour(inText, inTemp, inProb, inTime) {
	return {text: inText, temp: inTemp, precipProb: inProb, hour: {time: inTime || "14:00", suffix: ""}};
}

test("day summary: likely rain, slight chance, dry", function() {
	var wet = [hour("Overcast", 12, 10), hour("Overcast", 14, 60, "15:00"), hour("Rain", 11, 80)];
	assert.strictEqual(W.daySummary(wet, "metric"), "Overcast. Precipitation likely from 15:00 (60%). Between 11° and 14°.");
	var maybe = [hour("Partly cloudy", 9, 30), hour("Partly cloudy", 10, 0)];
	assert.strictEqual(W.daySummary(maybe, "metric"), "Partly cloudy. Small chance of precipitation (30%). Between 9° and 10°.");
	assert.strictEqual(W.daySummary([hour("Clear", 20, 0)], "metric"), "Clear. Dry. Between 20° and 20°.");
	assert.strictEqual(W.daySummary([], "metric"), "");
});

function day(inName, inHigh, inProb, inSum) {
	return {dayName: inName, high: inHigh, precipProb: inProb, precipSum: inSum};
}

test("week summary: some wet days, dry week, wet week", function() {
	var some = [day("Monday", 15, 80, 4), day("Tuesday", 18, 10, 0), day("Wednesday", 16, 60, 2), day("Thursday", 14, 70, 0.2)];
	assert.strictEqual(W.weekSummary(some, "metric"), "Precipitation on Monday and Wednesday; temperatures peaking at 18° on Tuesday.");
	assert.strictEqual(W.weekSummary([day("Monday", 15, 0, 0), day("Tuesday", 12, 0, 0)], "metric"), "Dry all week; temperatures peaking at 15° on Monday.");
	var wet = [day("Monday", 10, 90, 5), day("Tuesday", 11, 90, 5), day("Wednesday", 9, 90, 5)];
	assert.strictEqual(W.weekSummary(wet, "metric"), "Wet most of the week; temperatures peaking at 11° on Tuesday.");
});

// --- Whole model against real responses -----------------------------------

test("model: Utrecht, metric, 24h", function() {
	var m = W.model(fixture("forecast-utrecht-metric.json"), "metric", true);
	assert.strictEqual(m.timezone, "Europe/Amsterdam");
	assert.strictEqual(m.current.temp, 14);
	assert.strictEqual(m.current.icon, "cloudy");
	assert.strictEqual(m.current.isDay, false);
	assert.strictEqual(m.current.windDir, "S");
	assert.strictEqual(m.current.pressure, 1028);
	assert.deepStrictEqual(m.sunrise, {time: "08:02", suffix: ""});
	assert.strictEqual(m.unitLabels.wind, "km/h");
	assert.strictEqual(m.days.length, 10);
	assert.strictEqual(m.days[0].label, "Today");
	assert.strictEqual(m.days[1].label, "Tomorrow");
	assert.ok(m.hours.length > 20, "hours: " + m.hours.length);
	// The list starts at the hour we are in, and every day change is marked.
	assert.strictEqual(m.hours[0].time.slice(0, 13), m.current.time.slice(0, 13));
	var dividers = m.hours.filter(function(h) { return h.newDay; });
	assert.ok(dividers.length >= 1);
	assert.strictEqual(dividers[0].time.slice(11), "00:00");
	assert.ok(m.summary.hour && m.summary.day && m.summary.week);
});

test("model: Philadelphia, imperial, 12h", function() {
	var m = W.model(fixture("forecast-philadelphia-imperial.json"), "imperial", false);
	assert.strictEqual(m.current.temp, 79);
	assert.strictEqual(m.current.feels, 83);
	assert.strictEqual(m.current.visibility, 14);
	assert.strictEqual(m.unitLabels.temp, "°F");
	assert.ok(/am|pm/.test(m.sunrise.suffix));
	assert.ok(/^\d{1,2}$/.test(m.hours[0].hour.time), m.hours[0].hour.time);
});

test("model: Tromsø has sunrise/sunset today", function() {
	var m = W.model(fixture("forecast-tromso-metric.json"), "metric", true);
	assert.deepStrictEqual(m.sunrise, {time: "07:50", suffix: ""});
	assert.deepStrictEqual(m.sunset, {time: "17:08", suffix: ""});
});

test("model: copes with a polar-night day without sunrise", function() {
	var j = fixture("forecast-tromso-metric.json");
	j.daily.sunrise[0] = null;
	j.daily.sunset[0] = null;
	var m = W.model(j, "metric", true);
	assert.deepStrictEqual(m.sunrise, {time: "", suffix: ""});
});

test("model: empty response does not throw", function() {
	var m = W.model({}, "metric", true);
	assert.strictEqual(m.hours.length, 0);
	assert.strictEqual(m.days.length, 0);
});

// --- Places --------------------------------------------------------------

test("search results disambiguate same-named places", function() {
	var r = W.mapSearch(fixture("geocode-utrecht.json"));
	assert.ok(r.length >= 3);
	assert.strictEqual(r[0].name, "Utrecht");
	assert.strictEqual(r[0].detail, "The Netherlands");
	assert.strictEqual(r[0].country, "NL");
	assert.ok(r[1].detail.indexOf("KwaZulu-Natal") === 0, r[1].detail);
	assert.deepStrictEqual(W.mapSearch({}), []);
});

test("Nominatim search fills the gap Open-Meteo leaves for 'Tromso'", function() {
	var om = W.mapSearch(fixture("geocode-tromso.json"));
	var nom = W.mapNominatimSearch(fixture("nominatim-search-tromso.json"));
	assert.strictEqual(nom[0].name, "Tromsø");
	assert.strictEqual(nom[0].detail, "Troms, Norway");
	assert.strictEqual(nom[0].country, "NO");
	var merged = W.mergePlaces(om, nom, "Tromso");
	assert.deepStrictEqual(merged.map(function(p) { return p.name; }), ["Tromsø", "Romssasuolu"]);
	assert.deepStrictEqual(W.mapNominatimSearch({}), []);
});

test("mergePlaces drops places already listed nearby", function() {
	var a = [{name: "Utrecht", lat: 52.09, lon: 5.12}];
	var b = [{name: "Utrecht", lat: 52.0907, lon: 5.1214}, {name: "Utrecht", lat: -27.65, lon: 30.32}];
	assert.strictEqual(W.mergePlaces(a, b).length, 2);
});

test("fold handles letters NFD cannot split", function() {
	assert.strictEqual(W.fold("Tromsø"), "tromso");
	assert.strictEqual(W.fold("Köln"), "koln");
	assert.strictEqual(W.fold("Łódź"), "lodz");
});

test("reverse geocode picks the town", function() {
	assert.deepStrictEqual(W.mapReverse(fixture("reverse-utrecht.json")), {name: "Utrecht", country: "NL"});
	assert.deepStrictEqual(W.mapReverse({address: {village: "Ee", country_code: "nl"}}), {name: "Ee", country: "NL"});
	assert.deepStrictEqual(W.mapReverse(null), {name: "", country: ""});
});

harness.run();
