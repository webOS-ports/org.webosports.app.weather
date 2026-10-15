/*
	Weather data for LuneOS: Open-Meteo forecast -> what the views show.

	Dash Weather+ was built on Forecast.io (Dark Sky), which shut down in
	2023, and on Google's keyless geocoder, which no longer exists. This
	module replaces both with keyless services:
	  - forecasts: Open-Meteo (open-meteo.com, data CC BY 4.0)
	  - place search: Open-Meteo geocoding (GeoNames)
	  - place name for a GPS fix: Nominatim (OpenStreetMap)

	Dark Sky wrote the "Your Hour / Day / Week" sentences itself; Open-Meteo
	has none, so they are composed here from the minutely, hourly and daily
	data.

	Open-Meteo is asked for timezone=auto, so every timestamp is local time
	at the forecast location ("2026-10-14T20:15", no offset). Times are
	formatted straight from those strings and never pass through Date in the
	device's timezone: a forecast for Tokyo shows Tokyo's sunrise.

	No enyo or DOM in here, so tools/tests/ can run it under node.
*/
var WeatherData = {
	forecastBase: "https://api.open-meteo.com/v1/forecast",
	geocodeBase: "https://geocoding-api.open-meteo.com/v1/search",
	reverseBase: "https://nominatim.openstreetmap.org/reverse",

	//* Days in the Daily tab and hours in the Hourly tab.
	days: 10,
	hours: 48,

	//* Translation hook; App.js points this at $L.
	L: function(inText) {
		return inText;
	},

	// --- URLs ------------------------------------------------------------

	query: function(inParams) {
		var parts = [];
		for (var k in inParams) {
			if (inParams.hasOwnProperty(k) && inParams[k] !== undefined && inParams[k] !== null && inParams[k] !== "") {
				parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(inParams[k]));
			}
		}
		return "?" + parts.join("&");
	},

	//* inUnits: "metric" or "imperial".
	forecastUrl: function(inLat, inLon, inUnits) {
		var p = {
			latitude: (+inLat).toFixed(4),
			longitude: (+inLon).toFixed(4),
			current: "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation," +
				"weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index",
			minutely_15: "precipitation",
			hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code," +
				"cloud_cover,wind_speed_10m,is_day",
			daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max," +
				"sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max",
			timezone: "auto",
			forecast_days: this.days,
			forecast_hours: this.hours,
			forecast_minutely_15: 8
		};
		if (inUnits === "imperial") {
			p.temperature_unit = "fahrenheit";
			p.wind_speed_unit = "mph";
			p.precipitation_unit = "inch";
		}
		return this.forecastBase + this.query(p);
	},

	searchUrl: function(inText, inLang) {
		return this.geocodeBase + this.query({name: inText, count: 10, language: inLang || "en", format: "json"});
	},

	reverseUrl: function(inLat, inLon, inLang) {
		return this.reverseBase + this.query({format: "jsonv2", lat: (+inLat).toFixed(4), lon: (+inLon).toFixed(4),
			zoom: 10, "accept-language": inLang || "en"});
	},

	// --- Units -----------------------------------------------------------

	//* The few countries that still use Fahrenheit day to day.
	imperialCountries: {US: 1, LR: 1, MM: 1, BS: 1, KY: 1, PW: 1, FM: 1, MH: 1},

	/**
		"optAuto" follows the place being shown, as Dark Sky's "auto" did: a
		US city reads in °F, the rest of the world in °C. The device locale is
		deliberately not used; LuneOS devices often run en-US whatever their
		region.
	*/
	resolveUnits: function(inPref, inCountryCode) {
		if (inPref === "optImperial") {
			return "imperial";
		}
		if (inPref === "optMetric") {
			return "metric";
		}
		return this.imperialCountries[(inCountryCode || "").toUpperCase()] ? "imperial" : "metric";
	},

	/**
		"opt24hour"/"opt12hour", or "optAuto": the system's timeFormat
		preference ("HH12"/"HH24", from com.palm.systemservice), and only
		without one a guess from the locale.
	*/
	resolve24h: function(inPref, inSystemFormat, inLocale) {
		if (inPref === "opt24hour") {
			return true;
		}
		if (inPref === "opt12hour") {
			return false;
		}
		if (inSystemFormat === "HH24" || inSystemFormat === "HH12") {
			return inSystemFormat === "HH24";
		}
		return !/^en[-_](US|CA|AU|NZ|PH|IN)$/i.test(inLocale || "");
	},

	// --- Conditions ------------------------------------------------------

	/**
		WMO weather code -> Dash Weather's icon names (the Dark Sky set the
		icon packs and backgrounds are drawn for) and a description.
	*/
	codes: {
		0: ["clear", "Clear"],
		1: ["clear", "Mostly clear"],
		2: ["partly-cloudy", "Partly cloudy"],
		3: ["cloudy", "Overcast"],
		45: ["fog", "Fog"],
		48: ["fog", "Freezing fog"],
		51: ["rain", "Light drizzle"],
		53: ["rain", "Drizzle"],
		55: ["rain", "Heavy drizzle"],
		56: ["sleet", "Freezing drizzle"],
		57: ["sleet", "Freezing drizzle"],
		61: ["rain", "Light rain"],
		63: ["rain", "Rain"],
		65: ["rain", "Heavy rain"],
		66: ["sleet", "Freezing rain"],
		67: ["sleet", "Heavy freezing rain"],
		71: ["snow", "Light snow"],
		73: ["snow", "Snow"],
		75: ["snow", "Heavy snow"],
		77: ["snow", "Snow grains"],
		80: ["rain", "Light showers"],
		81: ["rain", "Showers"],
		82: ["rain", "Heavy showers"],
		85: ["snow", "Snow showers"],
		86: ["snow", "Heavy snow showers"],
		95: ["rain", "Thunderstorm"],
		96: ["rain", "Thunderstorm with hail"],
		99: ["rain", "Thunderstorm with hail"]
	},

	//* Sustained wind, in km/h, from which a dry sky is called windy (Beaufort 6).
	windyKmh: 39,

	toKmh: function(inSpeed, inUnits) {
		return inUnits === "imperial" ? inSpeed * 1.609344 : inSpeed;
	},

	/**
		{icon, text} for a code. inIsDay picks the day or night variant of
		clear/partly-cloudy; inWind (in the response's units) turns a dry,
		blowing sky into "wind", which Dark Sky also did.
	*/
	condition: function(inCode, inIsDay, inWind, inUnits) {
		var c = this.codes[inCode] || ["na", "Unknown"];
		var icon = c[0], text = this.L(c[1]);
		if (icon === "clear" || icon === "partly-cloudy") {
			icon += inIsDay ? "-day" : "-night";
		}
		if (inCode <= 3 && inWind !== undefined && this.toKmh(inWind, inUnits) >= this.windyKmh) {
			icon = "wind";
			text = this.L("Windy") + ", " + text.charAt(0).toLowerCase() + text.slice(1);
		}
		return {icon: icon, text: text};
	},

	//* Photo behind the app; the backgrounds folder has no wind or na picture.
	background: function(inIcon) {
		if (inIcon === "wind" || inIcon === "na") {
			return "cloudy";
		}
		return inIcon;
	},

	isWet: function(inCode) {
		return inCode >= 51;
	},

	isSnow: function(inCode) {
		return (inCode >= 71 && inCode <= 77) || inCode === 85 || inCode === 86;
	},

	// --- Formatting ------------------------------------------------------

	pad: function(n) {
		return n < 10 ? "0" + n : "" + n;
	},

	//* "2026-10-14T20:15" -> {y, mo, d, h, mi}; null when unparseable.
	parse: function(inStr) {
		var m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(inStr || "");
		if (!m) {
			return null;
		}
		return {y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0)};
	},

	/**
		Clock time as plain text plus an optional am/pm suffix, so the view
		can style the suffix like Dash Weather did without HTML coming from
		here. Returns {time, suffix}.
	*/
	clock: function(inStr, in24h) {
		var t = this.parse(inStr);
		if (!t) {
			return {time: "", suffix: ""};
		}
		if (in24h) {
			return {time: this.pad(t.h) + ":" + this.pad(t.mi), suffix: ""};
		}
		var h = t.h % 12 || 12;
		return {time: h + ":" + this.pad(t.mi), suffix: t.h < 12 ? "am" : "pm"};
	},

	//* Hour only, for the hourly list: "14:00" or "2pm".
	hourLabel: function(inStr, in24h) {
		var t = this.parse(inStr);
		if (!t) {
			return {time: "", suffix: ""};
		}
		if (in24h) {
			return {time: this.pad(t.h) + ":00", suffix: ""};
		}
		return {time: "" + (t.h % 12 || 12), suffix: t.h < 12 ? "am" : "pm"};
	},

	weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
	months: ["January", "February", "March", "April", "May", "June", "July", "August", "September",
		"October", "November", "December"],

	//* Day of week of a local date string, without involving the device's timezone.
	weekday: function(inStr) {
		var t = this.parse(inStr);
		return t ? new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay() : 0;
	},

	dayName: function(inStr) {
		return this.L(this.weekdays[this.weekday(inStr)]);
	},

	//* "Wednesday, October 14"
	dateLabel: function(inStr) {
		var t = this.parse(inStr);
		if (!t) {
			return "";
		}
		return this.dayName(inStr) + ", " + this.L(this.months[t.mo - 1]) + " " + t.d;
	},

	compass: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],

	windDirection: function(inDegrees, inSpeed) {
		if (inSpeed !== undefined && inSpeed < 1) {
			return this.L("Calm");
		}
		if (inDegrees === undefined || inDegrees === null || isNaN(inDegrees)) {
			return "?";
		}
		return this.L(this.compass[Math.round((((inDegrees % 360) + 360) % 360) / 45) % 8]);
	},

	/**
		Precipitation rate in words, from the response's units per hour
		(mm or inch). Dash Weather's thresholds, which were in inch/h.
	*/
	precipWord: function(inRate, inUnits) {
		var inch = inUnits === "imperial" ? inRate : inRate / 25.4;
		if (!inch) {
			return this.L("None");
		}
		if (inch < 0.002) {
			return this.L("Sprinkling");
		}
		if (inch < 0.017) {
			return this.L("Light");
		}
		if (inch < 0.1) {
			return this.L("Moderate");
		}
		return this.L("Heavy");
	},

	units: function(inUnits) {
		return inUnits === "imperial" ?
			{temp: "°F", wind: "mph", distance: "mi", precip: "in", pressure: "inHg"} :
			{temp: "°C", wind: "km/h", distance: "km", precip: "mm", pressure: "hPa"};
	},

	round: function(inValue) {
		return inValue === undefined || inValue === null || isNaN(inValue) ? null : Math.round(inValue);
	},

	//* Visibility arrives in metres (metric) or feet (imperial).
	visibility: function(inValue, inUnits) {
		if (inValue === undefined || inValue === null) {
			return null;
		}
		var v = inUnits === "imperial" ? inValue / 5280 : inValue / 1000;
		return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
	},

	//* Pressure always arrives in hPa.
	pressure: function(inHpa, inUnits) {
		if (inHpa === undefined || inHpa === null) {
			return null;
		}
		return inUnits === "imperial" ? Math.round(inHpa * 0.02953 * 100) / 100 : Math.round(inHpa);
	},

	// --- Summaries -------------------------------------------------------

	/**
		The next hour or two, from the 15-minute precipitation. Says when
		rain or snow starts or stops; quiet otherwise.
	*/
	hourSummary: function(inMinutely, inCurrent, inUnits) {
		var L = this.L;
		var list = (inMinutely && inMinutely.precipitation) || [];
		var kind = this.isSnow(inCurrent.weather_code) ? L("Snow") : L("Rain");
		// 0.1 mm (or 0.004 in) per quarter hour is the least worth mentioning.
		var wet = inUnits === "imperial" ? 0.004 : 0.1;
		if (!list.length) {
			return this.condition(inCurrent.weather_code, inCurrent.is_day).text + ".";
		}
		var nowWet = list[0] >= wet;
		for (var i = 1; i < list.length; i++) {
			if ((list[i] >= wet) !== nowWet) {
				var mins = i * 15;
				return nowWet ?
					kind + " " + L("stopping in about") + " " + mins + " " + L("min") + "." :
					kind + " " + L("starting in about") + " " + mins + " " + L("min") + ".";
			}
		}
		var span = list.length * 15 >= 120 ? L("the next two hours") : L("the next hour");
		return nowWet ? kind + " " + L("for") + " " + span + "." : L("No precipitation for") + " " + span + ".";
	},

	/**
		The coming 24 hours: what the sky mostly does, when rain gets likely,
		and the temperature range.
	*/
	daySummary: function(inHours, inUnits) {
		var L = this.L;
		var hours = inHours.slice(0, 24);
		if (!hours.length) {
			return "";
		}
		// Most common condition text over the period.
		var counts = {}, best = null;
		var hi = -Infinity, lo = Infinity;
		var firstWet = null, maxProb = 0;
		for (var i = 0; i < hours.length; i++) {
			var h = hours[i];
			counts[h.text] = (counts[h.text] || 0) + 1;
			if (!best || counts[h.text] > counts[best]) {
				best = h.text;
			}
			hi = Math.max(hi, h.temp);
			lo = Math.min(lo, h.temp);
			if (h.precipProb > maxProb) {
				maxProb = h.precipProb;
			}
			if (firstWet === null && h.precipProb >= 50) {
				firstWet = h;
			}
		}
		var s = best + ". ";
		if (firstWet) {
			s += L("Precipitation likely from") + " " + firstWet.hour.time + (firstWet.hour.suffix || "") + " (" + firstWet.precipProb + "%). ";
		} else if (maxProb >= 25) {
			s += L("Small chance of precipitation") + " (" + maxProb + "%). ";
		} else {
			s += L("Dry") + ". ";
		}
		s += L("Between") + " " + lo + "° " + L("and") + " " + hi + "°.";
		return s;
	},

	/**
		The coming week, in Dark Sky's spirit: which days are wet, and the
		warmest day.
	*/
	weekSummary: function(inDays, inUnits) {
		var L = this.L;
		var week = inDays.slice(0, 7);
		if (!week.length) {
			return "";
		}
		// 1 mm (0.04 in) and a better-than-even chance make a wet day.
		var wetAmount = inUnits === "imperial" ? 0.04 : 1;
		var wet = [], peak = week[0];
		for (var i = 0; i < week.length; i++) {
			var d = week[i];
			if (d.precipProb >= 50 && d.precipSum >= wetAmount) {
				wet.push(d);
			}
			if (d.high > peak.high) {
				peak = d;
			}
		}
		var s;
		if (!wet.length) {
			s = L("Dry all week");
		} else if (wet.length >= week.length - 1) {
			s = L("Wet most of the week");
		} else {
			var names = [];
			for (var j = 0; j < wet.length; j++) {
				names.push(wet[j].dayName);
			}
			var last = names.pop();
			s = L("Precipitation on") + " " + (names.length ? names.join(", ") + " " + L("and") + " " : "") + last;
		}
		return s + "; " + L("temperatures peaking at") + " " + peak.high + "° " + L("on") + " " + peak.dayName + ".";
	},

	// --- The model -------------------------------------------------------

	/**
		Open-Meteo forecast -> everything the views render. inUnits is what
		the request was made with; in24h picks the clock style.
	*/
	model: function(inJson, inUnits, in24h) {
		var c = inJson.current || {};
		var h = inJson.hourly || {};
		var d = inJson.daily || {};
		var self = this;

		var now = this.condition(c.weather_code, c.is_day, c.wind_speed_10m, inUnits);
		var current = {
			icon: now.icon,
			text: now.text,
			isDay: !!c.is_day,
			temp: this.round(c.temperature_2m),
			feels: this.round(c.apparent_temperature),
			humidity: this.round(c.relative_humidity_2m),
			cloud: this.round(c.cloud_cover),
			pressure: this.pressure(c.pressure_msl, inUnits),
			windSpeed: this.round(c.wind_speed_10m),
			windGust: this.round(c.wind_gusts_10m),
			windDir: this.windDirection(c.wind_direction_10m, c.wind_speed_10m),
			visibility: this.visibility(c.visibility, inUnits),
			uv: this.round(c.uv_index),
			// Current precipitation is per 15 min; x4 for a rate per hour.
			precip: this.precipWord((c.precipitation || 0) * 4, inUnits),
			time: c.time
		};

		// Hourly, starting at the hour we are in.
		var hours = [];
		var startHour = (c.time || "").slice(0, 13);
		var started = false;
		for (var i = 0; h.time && i < h.time.length; i++) {
			if (!started && startHour && h.time[i].slice(0, 13) < startHour) {
				continue;
			}
			started = true;
			var hc = this.condition(h.weather_code[i], h.is_day[i], h.wind_speed_10m[i], inUnits);
			var prev = hours.length ? hours[hours.length - 1] : null;
			var date = h.time[i].slice(0, 10);
			hours.push({
				time: h.time[i],
				date: date,
				hour: this.hourLabel(h.time[i], in24h),
				// The first hour of each new day carries its name, for a divider.
				newDay: prev && prev.date !== date ? this.dayName(h.time[i]) : "",
				icon: hc.icon,
				text: hc.text,
				temp: this.round(h.temperature_2m[i]),
				feels: this.round(h.apparent_temperature[i]),
				precipProb: this.round(h.precipitation_probability[i]) || 0,
				precip: h.precipitation[i] || 0,
				cloud: this.round(h.cloud_cover[i]),
				wind: this.round(h.wind_speed_10m[i])
			});
		}

		var days = [];
		for (var j = 0; d.time && j < d.time.length; j++) {
			var dc = this.condition(d.weather_code[j], true, d.wind_speed_10m_max[j], inUnits);
			var day = {
				date: d.time[j],
				dayName: this.dayName(d.time[j]),
				label: j === 0 ? this.L("Today") : j === 1 ? this.L("Tomorrow") : this.dateLabel(d.time[j]),
				icon: dc.icon,
				text: dc.text,
				high: this.round(d.temperature_2m_max[j]),
				low: this.round(d.temperature_2m_min[j]),
				precipProb: this.round(d.precipitation_probability_max[j]) || 0,
				precipSum: d.precipitation_sum[j] || 0,
				uv: this.round(d.uv_index_max[j]),
				wind: this.round(d.wind_speed_10m_max[j]),
				gust: this.round(d.wind_gusts_10m_max[j]),
				sunrise: d.sunrise[j],
				sunset: d.sunset[j]
			};
			day.forecast = this.dayForecast(day, inUnits);
			days.push(day);
		}

		// Polar day or night: Open-Meteo still gives a time, but it can be
		// missing altogether, so the view must cope with an empty string.
		var today = days[0] || {};
		return {
			units: inUnits,
			unitLabels: this.units(inUnits),
			timezone: inJson.timezone,
			current: current,
			sunrise: this.clock(today.sunrise, in24h),
			sunset: this.clock(today.sunset, in24h),
			hours: hours,
			days: days,
			summary: {
				hour: this.hourSummary(inJson.minutely_15, c, inUnits),
				day: this.daySummary(hours, inUnits),
				week: this.weekSummary(days, inUnits)
			}
		};
	},

	//* One line under a day in the Daily tab.
	dayForecast: function(inDay, inUnits) {
		var L = this.L, u = this.units(inUnits);
		var parts = [inDay.text];
		if (inDay.precipProb >= 20 && inDay.precipSum > 0) {
			var amount = inUnits === "imperial" ? Math.round(inDay.precipSum * 100) / 100 : Math.round(inDay.precipSum * 10) / 10;
			parts.push(inDay.precipProb + "% " + L("chance") + ", " + amount + " " + u.precip);
		}
		if (inDay.gust !== null && this.toKmh(inDay.gust, inUnits) >= 50) {
			parts.push(L("gusts up to") + " " + inDay.gust + " " + u.wind);
		}
		if (inDay.uv !== null && inDay.uv >= 6) {
			parts.push(L("UV") + " " + inDay.uv);
		}
		return parts.join(" · ");
	},

	// --- Places ----------------------------------------------------------

	/**
		Open-Meteo geocoding -> [{name, detail, lat, lon, country}], for the
		location search list. detail disambiguates the five Utrechts.
	*/
	mapSearch: function(inJson) {
		var out = [];
		var list = (inJson && inJson.results) || [];
		for (var i = 0; i < list.length; i++) {
			var r = list[i];
			var detail = [];
			if (r.admin1 && r.admin1 !== r.name) {
				detail.push(r.admin1);
			}
			if (r.country) {
				detail.push(r.country);
			}
			out.push({
				name: r.name,
				detail: detail.join(", "),
				lat: r.latitude,
				lon: r.longitude,
				country: (r.country_code || "").toUpperCase()
			});
		}
		return out;
	},

	/**
		Nominatim search -> the same shape as mapSearch. Used as a second
		source: Open-Meteo's search does not fold diacritics, so "Tromso"
		misses Tromsø, which Nominatim finds.
	*/
	mapNominatimSearch: function(inJson) {
		var out = [];
		var list = inJson instanceof Array ? inJson : [];
		for (var i = 0; i < list.length; i++) {
			var r = list[i], a = r.address || {};
			var name = r.name || a.city || a.town || a.village || a.municipality || "";
			if (!name) {
				continue;
			}
			var detail = [];
			var region = a.state || a.county || "";
			if (region && region !== name) {
				detail.push(region);
			}
			if (a.country) {
				detail.push(a.country);
			}
			out.push({name: name, detail: detail.join(", "), lat: +r.lat, lon: +r.lon,
				country: (a.country_code || "").toUpperCase()});
		}
		return out;
	},

	/**
		Lower case, no diacritics, for comparing place names. NFD splits most
		accents off; ø, æ, ß, ł and đ have no decomposition and are mapped by
		hand.
	*/
	fold: function(inText) {
		var s = (inText || "").toLowerCase();
		if (s.normalize) {
			s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
		}
		return s.replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ß/g, "ss").replace(/ł/g, "l").replace(/đ/g, "d");
	},

	/**
		inFirst plus what inSecond adds, best match for inQuery first. A
		place counts as already listed when it has the same name, or lies
		within ~3 km: Tromsø and the island it stands on (Romssasuolu) are
		3 km apart and both real answers.
	*/
	mergePlaces: function(inFirst, inSecond, inQuery) {
		var self = this;
		var out = inFirst.slice();
		for (var i = 0; i < inSecond.length; i++) {
			var p = inSecond[i], dup = false;
			for (var j = 0; j < out.length && !dup; j++) {
				var near = Math.abs(out[j].lat - p.lat) < 0.03 && Math.abs(out[j].lon - p.lon) < 0.03;
				var close = Math.abs(out[j].lat - p.lat) < 0.1 && Math.abs(out[j].lon - p.lon) < 0.1;
				dup = near || (close && self.fold(out[j].name) === self.fold(p.name));
			}
			if (!dup) {
				out.push(p);
			}
		}
		if (inQuery) {
			var q = this.fold(inQuery);
			var rank = function(inPlace) {
				var n = self.fold(inPlace.name);
				return n === q ? 0 : n.indexOf(q) === 0 ? 1 : 2;
			};
			// Stable: keep each source's own order within a rank.
			out = out.map(function(p, i) { return {p: p, i: i}; }).sort(function(a, b) {
				return rank(a.p) - rank(b.p) || a.i - b.i;
			}).map(function(x) { return x.p; });
		}
		return out;
	},

	nominatimSearchUrl: function(inText, inLang) {
		return "https://nominatim.openstreetmap.org/search" + this.query({q: inText, format: "jsonv2", addressdetails: 1,
			limit: 8, featureType: "settlement", "accept-language": inLang || "en"});
	},

	//* Nominatim reverse -> {name, country}; the town rather than the street.
	mapReverse: function(inJson) {
		var a = (inJson && inJson.address) || {};
		var name = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb ||
			a.county || a.state || (inJson && inJson.name) || "";
		return {name: name, country: (a.country_code || "").toUpperCase()};
	}
};

if (typeof module !== "undefined") {
	module.exports = WeatherData;
}
