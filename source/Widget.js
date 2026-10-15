/*
	Copyright 2013 Garrett G Downs Jr

	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.

	Modified for LuneOS by WebOS Ports, 2026: rewritten on WeatherData /
	WeatherStore, shares the app's place and cached forecast instead of
	locating and fetching on its own, optional hourly strip.
*/

/**
	The notification-area widget (a webOS dashboard window), opened by
	WeatherApp.openWidget() with widget.html.

	It shows the app's active place from the forecast the app cached in
	localStorage, and redraws when the app stores a newer one (the storage
	event fires in the other windows of the same origin). While shown it
	refreshes a stale forecast itself, by coordinates only: it never starts
	the GPS, which stays the app's job. Tap the icon to refresh, anywhere
	else to bring the app forward.
*/
enyo.kind({
	name: "WeatherWidget",
	kind: "enyo.Control",
	classes: "weather-widget",

	//* Refetch a forecast older than this, in ms.
	staleAfter: 30 * 60000,
	//* How often to check, in ms.
	checkEvery: 5 * 60000,

	components: [
		{name: "launcher", kind: "enyo.PalmService", service: "luna://com.palm.applicationManager/", method: "launch"},
		{classes: "widget-row", ontap: "openApp", components: [
			{name: "icon", classes: "widget-icon", ontap: "refreshTapped"},
			{name: "temp", classes: "widget-temp", allowHtml: true, content: "--&deg;"},
			{classes: "widget-status", components: [
				{name: "place", classes: "widget-line1"},
				{name: "status", classes: "widget-line2", allowHtml: true, content: $L("Open Weather to set a place")}
			]}
		]},
		{name: "hours", classes: "widget-hours", allowHtml: true, ontap: "openApp"}
	],

	create: function() {
		this.inherited(arguments);
		this.hourly = /[?&]size=hourly\b/.test(window.location.search);
		this.addRemoveClass("with-hours", this.hourly);
		this.$.hours.setShowing(this.hourly);
		this.locale = navigator.language || "en-US";
		this.onStorage = enyo.bind(this, "storageChanged");
		window.addEventListener("storage", this.onStorage);
		this.timer = setInterval(enyo.bind(this, "checkStale"), this.checkEvery);
	},

	rendered: function() {
		this.inherited(arguments);
		this.show();
		this.checkStale();
	},

	destroy: function() {
		window.removeEventListener("storage", this.onStorage);
		clearInterval(this.timer);
		this.inherited(arguments);
	},

	storageChanged: function(inEvent) {
		if (!inEvent.key || inEvent.key.indexOf(WeatherStore.key) === 0) {
			this.show();
		}
	},

	place: function() {
		var prefs = WeatherStore.loadPrefs();
		return {prefs: prefs, loc: prefs.locs[prefs.active] || prefs.locs[0]};
	},

	esc: function(inText) {
		return enyo.dom.escape(inText === undefined || inText === null ? "" : String(inText));
	},

	//* Draws the cached forecast for the app's active place.
	show: function() {
		var p = this.place();
		var cached = WeatherStore.getForecast(p.loc);
		this.$.place.setContent(p.loc.name || (p.loc.gps ? $L("Current Location") : ""));
		if (!cached || !cached.json) {
			return;
		}
		var in24h = WeatherData.resolve24h(p.prefs.hours, p.prefs.systemTimeFormat, this.locale);
		var m = WeatherData.model(cached.json, cached.units, in24h);
		var c = m.current, today = m.days[0];
		var icons = p.prefs.icons || "optIconsColor";
		this.$.icon.applyStyle("background-image", "url('assets/icons/" + icons + "/icon64/" + c.icon + ".png')");
		this.$.temp.setContent(c.temp === null ? "--&deg;" : this.esc(c.temp) + "&deg;");
		var status = this.esc(c.text);
		if (today && today.high !== null) {
			status += " <span class='widget-hilo'>" + this.esc(today.high) + "&deg; / " + this.esc(today.low) + "&deg;</span>";
		}
		this.$.status.setContent(status);

		if (this.hourly) {
			var html = "";
			// Skip the hour we are in; the row above already shows now.
			var hours = m.hours.slice(1, 7);
			for (var i = 0; i < hours.length; i++) {
				var h = hours[i];
				html += "<div class='widget-hour'><div class='widget-hour-time'>" + this.esc(h.hour.time) +
					(h.hour.suffix ? "<span class='label-units'>" + this.esc(h.hour.suffix) + "</span>" : "") + "</div>" +
					"<div class='widget-hour-icon' style=\"background-image: url('assets/icons/" + this.esc(icons) +
					"/icon32/" + this.esc(h.icon) + ".png')\"></div>" +
					"<div class='widget-hour-temp'>" + (h.temp === null ? "–" : this.esc(h.temp) + "&deg;") + "</div></div>";
			}
			this.$.hours.setContent(html);
		}
	},

	checkStale: function() {
		var p = this.place();
		var cached = WeatherStore.getForecast(p.loc);
		if (!cached || new Date().getTime() - cached.time > this.staleAfter) {
			this.refresh();
		}
	},

	refreshTapped: function() {
		this.refresh();
		// Refreshing is not a request to open the app.
		return true;
	},

	refresh: function() {
		var p = this.place();
		var loc = p.loc;
		if (loc.lat === null || loc.lat === undefined || this.loading) {
			return;
		}
		var units = WeatherData.resolveUnits(p.prefs.units, loc.country);
		this.loading = true;
		this.$.icon.addClass("loading");
		WeatherNet.getJson(WeatherData.forecastUrl(loc.lat, loc.lon, units), enyo.bind(this, function(inError, inJson) {
			this.loading = false;
			if (this.destroyed) {
				return;
			}
			this.$.icon.removeClass("loading");
			if (!inError) {
				WeatherStore.putForecast(loc, units, inJson);
				this.show();
			}
		}));
	},

	//* Brings the app card forward (or starts it), as tapping any dashboard does.
	openApp: function() {
		if (window.PalmSystem) {
			this.$.launcher.send({id: "org.webosports.app.weather", params: {}});
		}
	}
});
