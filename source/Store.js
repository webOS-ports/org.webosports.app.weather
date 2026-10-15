/*
	Preferences, saved places and the last forecast per place, in
	localStorage.

	Dash Weather+ kept a global appPrefs with places stored as Google
	geocoder query strings. Places are now resolved once, when they are
	added, and kept as coordinates, so no lookup is needed per refresh.

	Every access is wrapped: localStorage can throw when storage is full or
	disabled, and the app must still show the weather, just without
	remembering anything.
*/
var WeatherStore = {
	key: "org.webosports.app.weather.",

	defaults: function() {
		return {
			units: "optAuto",
			hours: "optAuto",
			icons: "optIconsColor",
			theme: "optThemeDefault",
			animations: true,
			// Notification-area widget: "off", "compact" or "hourly".
			widget: "off",
			firstUse: true,
			// The first place is always the device's own location.
			locs: [{gps: true, name: "", detail: "", lat: null, lon: null, country: ""}],
			active: 0
		};
	},

	get: function(inName, inDefault) {
		try {
			var raw = window.localStorage.getItem(this.key + inName);
			return raw === null ? inDefault : JSON.parse(raw);
		} catch (e) {
			return inDefault;
		}
	},

	set: function(inName, inValue) {
		try {
			window.localStorage.setItem(this.key + inName, JSON.stringify(inValue));
		} catch (e) {
			console.warn("WeatherStore.set(" + inName + ") failed: " + e);
		}
	},

	loadPrefs: function() {
		var prefs = this.defaults();
		var saved = this.get("prefs", null);
		if (saved && typeof saved === "object") {
			for (var k in saved) {
				if (saved.hasOwnProperty(k)) {
					prefs[k] = saved[k];
				}
			}
		}
		if (!prefs.locs || !prefs.locs.length || !prefs.locs[0].gps) {
			prefs.locs = this.defaults().locs.concat(prefs.locs || []);
		}
		if (!(prefs.active >= 0 && prefs.active < prefs.locs.length)) {
			prefs.active = 0;
		}
		return prefs;
	},

	savePrefs: function(inPrefs) {
		this.set("prefs", inPrefs);
	},

	//* Cache key for a place: GPS has one slot, saved places one each.
	placeKey: function(inLoc) {
		return inLoc.gps ? "gps" : (+inLoc.lat).toFixed(3) + "," + (+inLoc.lon).toFixed(3);
	},

	/**
		The last forecast for a place, as {time, units, json}. Shown straight
		away on launch so the card is never empty, then refreshed.
	*/
	getForecast: function(inLoc) {
		var all = this.get("forecasts", {});
		return all[this.placeKey(inLoc)] || null;
	},

	putForecast: function(inLoc, inUnits, inJson) {
		var all = this.get("forecasts", {});
		all[this.placeKey(inLoc)] = {time: new Date().getTime(), units: inUnits, json: inJson};
		// Keep it to the places that still exist, so storage cannot grow forever.
		var prefs = this.loadPrefs(), keep = {};
		for (var i = 0; i < prefs.locs.length; i++) {
			var k = this.placeKey(prefs.locs[i]);
			if (all[k]) {
				keep[k] = all[k];
			}
		}
		keep[this.placeKey(inLoc)] = all[this.placeKey(inLoc)];
		this.set("forecasts", keep);
	}
};

if (typeof module !== "undefined") {
	module.exports = WeatherStore;
}
