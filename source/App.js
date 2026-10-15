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

	Modified for LuneOS by WebOS Ports, 2026: Open-Meteo instead of
	Forecast.io, place search and GPS names without Google, cached
	forecasts, 48 hours / 10 days, settings that apply immediately.
	See git history for details.
*/

// enyo 2 has no $L of its own; on the device the system provides one.
if (typeof window.$L === "undefined") {
	window.$L = function(inText) {
		return inText;
	};
}
WeatherData.L = function(inText) {
	return $L(inText);
};

enyo.kind({
	name: "WeatherApp",
	kind: "FittableRows",
	classes: "main",
	fit: true,

	//* A forecast older than this is refetched when the card comes forward, in ms.
	staleAfter: 30 * 60000,

	components: [
		{kind: "enyo.Signals", onactivate: "activated", onrelaunch: "activated", onbackbutton: "backGesture"},
		{kind: "DeviceLocation", onLocated: "located", onLocationFailed: "locationFailed"},
		// The clock style follows Settings > Date & Time unless overridden here.
		// LuneOS grants this (systemsettings.query) on the OSE name only; the
		// legacy com.palm name is for old webOS, where the OSE one is unknown.
		{name: "systemPrefs", kind: "enyo.PalmService", service: "luna://com.webos.service.systemservice/",
			method: "getPreferences", subscribe: true, onResponse: "gotSystemPrefs", onError: "systemPrefsFailed"},
		{name: "legacySystemPrefs", kind: "enyo.PalmService", service: "luna://com.palm.systemservice/",
			method: "getPreferences", subscribe: true, onResponse: "gotSystemPrefs"},
		{kind: "FittableRows", fit: true, components: [
			{kind: "FittableColumns", classes: "header", components: [
				{name: "iconMain", classes: "icon", ontap: "refreshTapped"},
				{name: "currentTemp", classes: "temp", content: "--&deg;", allowHtml: true},
				{kind: "FittableRows", fit: true, classes: "status-box", components: [
					{name: "statusLine1", classes: "line1", content: $L("Weather")},
					{name: "statusLine2", classes: "line2", content: $L("Getting location...")},
					{name: "statusLine3", classes: "line3"}
				]},
				{classes: "header-blur"}
			]},
			{kind: "mochi.Panels", fit: true, classes: "tabs-container", onTransitionStart: "panelChanged",
				narrowFit: true, index: 1, components: [
				{name: "tabNow", classes: "panel-container"},
				{name: "tabCurrently", kind: "FittableRows", classes: "panel-container", components: [
					{kind: "mochi.Header", classes: "tab-header", content: $L("Currently")},
					{name: "currentlyContainer", kind: "enyo.Scroller", strategyKind: "TranslateScrollStrategy", thumb: false,
						horizontal: "hidden", fit: true, components: [
						{name: "helpSettings", kind: "FittableRows", classes: "help-box", ontap: "closeHelpBox", components: [
							{classes: "title", content: $L("Did you know?")},
							{classes: "desc", content: $L("Swipe left for the hourly and daily forecast, and once more for places and settings. Tap the weather icon to refresh.")}
						]},
						{name: "sysWarning", classes: "system-warning", showing: false},
						// Hidden until there is a forecast: empty headings look broken.
						{name: "summaries", showing: false, components: [
							{classes: "c-title", content: $L("Your Hour")},
							{name: "yourHour", classes: "c-desc"},
							{classes: "c-title", content: $L("Your Day")},
							{name: "yourDay", classes: "c-desc"},
							{classes: "c-title", content: $L("Your Week")},
							{name: "yourWeek", classes: "c-desc"},
							{classes: "c-title", content: $L("Right Now")},
						{name: "helpIcons", kind: "FittableRows", classes: "help-box", ontap: "closeHelpBox", components: [
							{classes: "title", content: $L("What are these icons?")},
							{kind: "FittableColumns", components: [
								{kind: "FittableRows", style: "width: 50%;", components: [
									{content: "- " + $L("Precipitation")},
									{content: "- " + $L("Cloud cover")},
									{content: "- " + $L("Wind")},
									{content: "- " + $L("Visibility")},
									{content: "- " + $L("UV index")}
								]},
								{kind: "FittableRows", style: "width: 50%; text-align: right;", components: [
									{content: $L("Sunrise") + " -"},
									{content: $L("Sunset") + " -"},
									{content: $L("Humidity") + " -"},
									{content: $L("Pressure") + " -"},
									{content: $L("Feels like") + " -"}
								]}
							]}
						]},
						{kind: "FittableColumns", components: [
							{kind: "FittableRows", classes: "currently-col", components: [
								{name: "elePrecip", kind: "CurrentlyElementL", icon: "rain"},
								{name: "eleCloud", kind: "CurrentlyElementL", icon: "cloudy"},
								{name: "eleWind", kind: "CurrentlyElementL", icon: "wind"},
								{name: "eleVis", kind: "CurrentlyElementL", icon: "fog"},
								{name: "eleUv", kind: "CurrentlyElementL", icon: "clear-day"}
							]},
							{kind: "FittableRows", classes: "currently-col", components: [
								{name: "eleSun", kind: "CurrentlyElementR", icon: "clear-day"},
								{name: "eleMoon", kind: "CurrentlyElementR", icon: "clear-night"},
								{name: "eleHumid", kind: "CurrentlyElementR", icon: "fog"},
								{name: "eleBaro", kind: "CurrentlyElementR", icon: "temp"},
								{name: "eleFeels", kind: "CurrentlyElementR", icon: "temp"}
							]}
						]},
						]},
						{classes: "powered-by", ontap: "openOpenMeteo", components: [
							{content: $L("Weather data by Open-Meteo.com")}
						]}
					]}
				]},
				{name: "tabHourly", kind: "FittableRows", classes: "panel-container", components: [
					{kind: "mochi.Header", classes: "tab-header", content: $L("Hourly")},
					{name: "hourlyContainer", kind: "enyo.Scroller", strategyKind: "TranslateScrollStrategy", thumb: false,
						horizontal: "hidden", fit: true, components: [
						{content: $L("Loading...")}
					]}
				]},
				{name: "tabDaily", kind: "FittableRows", classes: "panel-container", components: [
					{kind: "mochi.Header", classes: "tab-header", content: $L("Daily")},
					{name: "dailyContainer", kind: "enyo.Scroller", strategyKind: "TranslateScrollStrategy", thumb: false,
						horizontal: "hidden", fit: true, components: [
						{content: $L("Loading...")}
					]}
				]},
				{name: "tabMenu", kind: "FittableRows", classes: "panel-container menu", components: [
					{kind: "mochi.Header", classes: "tab-header", content: $L("Menu")},
					{name: "menuContainer", kind: "enyo.Scroller", strategyKind: "TranslateScrollStrategy", thumb: false,
						horizontal: "hidden", fit: true, components: [
						{classes: "c-title", content: $L("Places")},
						{name: "locationList"},
						// Plain blocks, not FittableColumns: the row starts hidden, and a
						// fitted child measured while hidden is fixed at 0px wide.
						{name: "searchRow", classes: "settings-row search-row", showing: false, components: [
							{kind: "mochi.InputDecorator", classes: "search-decorator", alwaysLooksFocused: true, components: [
								{name: "searchInput", kind: "mochi.Input", classes: "search-input", placeholder: $L("City or place"),
									onkeyup: "searchKeyUp"},
								{kind: "Image", src: "assets/search-input-search.png", ontap: "searchPlaces"}
							]}
						]},
						{name: "searchStatus", classes: "search-status", showing: false},
						{name: "searchResults"},
						{name: "addButton", kind: "mochi.Button", classes: "settings-button", content: $L("Add Place"), ontap: "addPlaceTapped"},
						{style: "height: 25px;"},
						{classes: "c-title", content: $L("Settings")},
						{kind: "FittableColumns", classes: "settings-row", components: [
							{content: $L("Units"), classes: "label", fit: true},
							{kind: "onyx.PickerDecorator", components: [
								{name: "prefUnitsButton", kind: "onyx.PickerButton", classes: "custom-picker"},
								{name: "prefUnitsPick", kind: "onyx.Picker", onChange: "prefChanged", components: [
									{content: $L("Auto"), name: "optAuto", active: true},
									{content: $L("Imperial"), name: "optImperial"},
									{content: $L("Metric"), name: "optMetric"}
								]}
							]}
						]},
						{kind: "FittableColumns", classes: "settings-row", components: [
							{content: $L("Time"), classes: "label", fit: true},
							{kind: "onyx.PickerDecorator", components: [
								{name: "prefTimeButton", kind: "onyx.PickerButton", classes: "custom-picker"},
								{name: "prefTimePick", kind: "onyx.Picker", onChange: "prefChanged", components: [
									{content: $L("Auto"), name: "optAutoHour", value: "optAuto", active: true},
									{content: $L("12 hour"), name: "opt12hour", value: "opt12hour"},
									{content: $L("24 hour"), name: "opt24hour", value: "opt24hour"}
								]}
							]}
						]},
						{kind: "FittableColumns", classes: "settings-row", components: [
							{content: $L("Icon Pack"), classes: "label", fit: true},
							{kind: "onyx.PickerDecorator", components: [
								{name: "prefIconsButton", kind: "onyx.PickerButton", classes: "custom-picker"},
								{name: "prefIconsPick", kind: "onyx.Picker", onChange: "prefChanged", components: [
									{content: $L("Color"), name: "optIconsColor", active: true},
									{content: $L("White"), name: "optIconsWhite"}
								]}
							]}
						]},
						{kind: "FittableColumns", classes: "settings-row", components: [
							{content: $L("Widget"), classes: "label", fit: true},
							{kind: "onyx.PickerDecorator", components: [
								{name: "prefWidgetButton", kind: "onyx.PickerButton", classes: "custom-picker"},
								{name: "prefWidgetPick", kind: "onyx.Picker", onChange: "widgetChanged", components: [
									{content: $L("Off"), name: "optWidgetOff", value: "off", active: true},
									{content: $L("Compact"), name: "optWidgetCompact", value: "compact"},
									{content: $L("Hourly"), name: "optWidgetHourly", value: "hourly"}
								]}
							]}
						]},
						{style: "height: 20px;"},
						{kind: "mochi.Button", classes: "settings-button", content: $L("Show Help Boxes"), ontap: "showHelpBoxes"},
						{name: "credits", classes: "credits", allowHtml: true},
						{style: "height: 60px;"}
					]}
				]}
			]},
			{kind: "TabIndicator"}
		]}
	],

	create: function() {
		this.inherited(arguments);
		this.prefs = WeatherStore.loadPrefs();
		this.locale = (navigator.language || "en-US");
		this.lang = this.locale.slice(0, 2).toLowerCase();
		this.loading = false;
		this.$.credits.setContent(
			enyo.dom.escape($L("Based on Dash Weather+ by Garrett Downs.")) + "<br>" +
			enyo.dom.escape($L("Forecasts: Open-Meteo.com (CC BY 4.0). Places: GeoNames via Open-Meteo, OpenStreetMap Nominatim.")));
		// webos-lib calls PalmSystem.stageReady() itself once rendered.
		if (window.PalmSystem) {
			this.$.systemPrefs.send({keys: ["timeFormat"]});
		}
	},

	rendered: function() {
		this.inherited(arguments);
		this.$.panels.getAnimator().setDuration(300);
		this.applyPrefsToPickers();
		this.populateLocations();
		if (this.prefs.firstUse) {
			this.showHelpBoxes();
			this.prefs.firstUse = false;
			this.savePrefs();
		}
		// Show the last forecast straight away, then refresh it.
		this.showCached();
		this.refreshData();
		if (this.prefs.widget !== "off") {
			this.openWidget();
		}
	},

	// --- Notification-area widget ---------------------------------------

	/**
		Grid units tall, per size. 5.6 is the shell's standard dashboard row,
		which it sizes after webOS's 52px dashboard CSS; the hourly widget
		is laid out for 120px, which is 13 of those units.
	*/
	widgetHeights: {compact: 5.6, hourly: 13},

	widgetChanged: function() {
		if (!this.hasNode()) {
			return;
		}
		var size = this.$.prefWidgetPick.getSelected().value;
		if (size === this.prefs.widget) {
			return;
		}
		this.prefs.widget = size;
		this.savePrefs();
		this.closeWidget();
		if (size !== "off") {
			this.openWidget();
		}
	},

	/**
		Opens widget.html as a dashboard: WAM turns the attributes into
		LuneOS_* window properties. The shell reads "LuneOS_dashheight"
		(lower case; WAM keeps the key's case, so Dash Weather's "dashHeight"
		was ignored there), in grid units with "metrics": "units", and
		"LuneOS_icon", relative to the app folder, for the notification bar.
	*/
	openWidget: function() {
		if (this.widgetWindow && !this.widgetWindow.closed) {
			return;
		}
		var size = this.prefs.widget === "hourly" ? "hourly" : "compact";
		var attributes = {window: "dashboard", dashheight: this.widgetHeights[size], metrics: "units",
			icon: "assets/icon-30.png"};
		this.widgetWindow = window.open("widget.html?size=" + size, "weatherWidget",
			"attributes=" + JSON.stringify(attributes));
	},

	closeWidget: function() {
		if (this.widgetWindow && !this.widgetWindow.closed) {
			this.widgetWindow.close();
		}
		this.widgetWindow = null;
	},

	// --- Preferences -----------------------------------------------------

	savePrefs: function() {
		WeatherStore.savePrefs(this.prefs);
	},

	applyPrefsToPickers: function() {
		this.$.prefUnitsPick.setSelected(this.$[this.prefs.units] || this.$.optAuto);
		var hourItem = {optAuto: "optAutoHour", opt12hour: "opt12hour", opt24hour: "opt24hour"}[this.prefs.hours];
		this.$.prefTimePick.setSelected(this.$[hourItem] || this.$.optAutoHour);
		this.$.prefIconsPick.setSelected(this.$[this.prefs.icons] || this.$.optIconsColor);
		var widgetItem = {off: "optWidgetOff", compact: "optWidgetCompact", hourly: "optWidgetHourly"}[this.prefs.widget];
		this.$.prefWidgetPick.setSelected(this.$[widgetItem] || this.$.optWidgetOff);
	},

	//* Settings apply as soon as they are picked; Dash Weather needed a Save button.
	prefChanged: function(inSender, inEvent) {
		if (!this.hasNode()) {
			return;
		}
		var units = this.$.prefUnitsPick.getSelected().name;
		var hours = this.$.prefTimePick.getSelected().value;
		var icons = this.$.prefIconsPick.getSelected().name;
		var unitsChanged = units !== this.prefs.units;
		var changed = unitsChanged || hours !== this.prefs.hours || icons !== this.prefs.icons;
		if (!changed) {
			return;
		}
		this.prefs.units = units;
		this.prefs.hours = hours;
		this.prefs.icons = icons;
		this.savePrefs();
		if (unitsChanged) {
			// Units are part of the request, so this needs fresh data.
			this.refreshData();
		} else if (this.lastJson) {
			this.render24hChange();
		}
	},

	render24hChange: function() {
		this.showForecast(this.lastJson, this.lastUnits);
	},

	is24h: function() {
		return WeatherData.resolve24h(this.prefs.hours, this.systemTimeFormat, this.locale);
	},

	systemPrefsFailed: function(inSender, inEvent) {
		var text = (inEvent.data && inEvent.data.errorText) || "";
		if (/Unknown (service|method)|not (found|running)/i.test(text)) {
			this.$.legacySystemPrefs.send({keys: ["timeFormat"]});
		} else {
			// Without it the clock style falls back to the locale; say why in the log.
			console.warn("timeFormat unavailable: " + text);
		}
	},

	gotSystemPrefs: function(inSender, inEvent) {
		var format = inEvent.data && inEvent.data.timeFormat;
		if (format && format !== this.systemTimeFormat) {
			this.systemTimeFormat = format;
			// The widget has no service subscription of its own; it reads this.
			this.prefs.systemTimeFormat = format;
			this.savePrefs();
			if (this.lastJson) {
				this.render24hChange();
			}
		}
	},

	unitsFor: function(inLoc) {
		return WeatherData.resolveUnits(this.prefs.units, inLoc.country);
	},

	activeLoc: function() {
		return this.prefs.locs[this.prefs.active] || this.prefs.locs[0];
	},

	// --- Places ----------------------------------------------------------

	populateLocations: function() {
		this.$.locationList.destroyClientControls();
		for (var i = 0; i < this.prefs.locs.length; i++) {
			var loc = this.prefs.locs[i];
			var name = loc.gps ? $L("Current Location") + (loc.name ? " (" + loc.name + ")" : "") : loc.name;
			this.$.locationList.createComponent({kind: "FittableColumns", classes: "location-row" + (i === this.prefs.active ? " active" : ""),
				index: i, ontap: "selectLocation", components: [
				{fit: true, components: [
					{content: name},
					{classes: "location-detail", content: loc.gps ? "" : loc.detail}
				]},
				// Dash Weather removed places on hold only, which nobody finds.
				{classes: "location-remove", content: "×", showing: !loc.gps, index: i, ontap: "removeLocation"}
			]}, {owner: this});
		}
		this.$.locationList.render();
	},

	selectLocation: function(inSender) {
		if (inSender.index === this.prefs.active) {
			this.$.panels.setIndex(1);
			return;
		}
		this.prefs.active = inSender.index;
		this.savePrefs();
		this.populateLocations();
		this.$.panels.setIndex(1);
		this.showCached();
		this.refreshData();
		return true;
	},

	removeLocation: function(inSender) {
		var i = inSender.index;
		if (i > 0 && i < this.prefs.locs.length) {
			this.prefs.locs.splice(i, 1);
			if (this.prefs.active === i) {
				this.prefs.active = 0;
				this.showCached();
				this.refreshData();
			} else if (this.prefs.active > i) {
				this.prefs.active--;
			}
			this.savePrefs();
			this.populateLocations();
		}
		// Do not also select the row underneath.
		return true;
	},

	addPlaceTapped: function() {
		if (!this.$.searchRow.getShowing()) {
			this.$.searchRow.setShowing(true);
			this.$.searchInput.setValue("");
			this.$.searchInput.focus();
			this.$.addButton.setContent($L("Search"));
		} else {
			this.searchPlaces();
		}
	},

	searchKeyUp: function(inSender, inEvent) {
		if (inEvent.keyCode === 13) {
			this.searchPlaces();
		}
	},

	searchPlaces: function() {
		var text = enyo.trim(this.$.searchInput.getValue() || "");
		if (text.length < 2) {
			return;
		}
		this.setSearchStatus($L("Searching..."));
		this.$.searchResults.destroyClientControls();
		var token = this.searchToken = (this.searchToken || 0) + 1;
		var stale = enyo.bind(this, function() {
			return token !== this.searchToken || this.destroyed;
		});
		WeatherNet.getJson(WeatherData.searchUrl(text, this.lang), enyo.bind(this, function(inError, inJson) {
			if (stale()) {
				return;
			}
			var first = inError ? [] : WeatherData.mapSearch(inJson);
			if (first.length >= 3) {
				this.showSearchResults(first, null);
				return;
			}
			// Few or no hits: Open-Meteo does not fold diacritics ("Tromso"
			// misses Tromsø), so ask Nominatim as well.
			WeatherNet.getJson(WeatherData.nominatimSearchUrl(text, this.lang), enyo.bind(this, function(inError2, inJson2) {
				if (stale()) {
					return;
				}
				var second = inError2 ? [] : WeatherData.mapNominatimSearch(inJson2);
				this.showSearchResults(WeatherData.mergePlaces(first, second, text), inError && inError2 ? inError : null);
			}));
		}));
	},

	showSearchResults: function(inPlaces, inError) {
		this.searchResultList = inPlaces;
		if (!inPlaces.length) {
			this.setSearchStatus(inError ? (inError.offline ? $L("No connection.") : $L("Search failed:") + " " + inError.message) :
				$L("No place found by that name."));
			return;
		}
		this.setSearchStatus("");
		for (var i = 0; i < inPlaces.length; i++) {
			var r = inPlaces[i];
			this.$.searchResults.createComponent({classes: "location-row search-result", index: i, ontap: "addSearchResult", components: [
				{content: r.name},
				{classes: "location-detail", content: r.detail}
			]}, {owner: this});
		}
		this.$.searchResults.render();
	},

	setSearchStatus: function(inText) {
		this.$.searchStatus.setContent(inText);
		this.$.searchStatus.setShowing(!!inText);
	},

	addSearchResult: function(inSender) {
		var r = this.searchResultList && this.searchResultList[inSender.index];
		if (!r) {
			return;
		}
		this.prefs.locs.push({gps: false, name: r.name, detail: r.detail, lat: r.lat, lon: r.lon, country: r.country});
		this.prefs.active = this.prefs.locs.length - 1;
		this.savePrefs();
		this.closeSearch();
		this.populateLocations();
		this.$.panels.setIndex(1);
		this.showCached();
		this.refreshData();
	},

	closeSearch: function() {
		this.$.searchRow.setShowing(false);
		this.$.searchResults.destroyClientControls();
		this.setSearchStatus("");
		this.$.addButton.setContent($L("Add Place"));
	},

	// --- Loading ---------------------------------------------------------

	refreshTapped: function() {
		this.refreshData();
	},

	activated: function() {
		if (this.loading) {
			return;
		}
		if (!this.loadedAt || new Date().getTime() - this.loadedAt > this.staleAfter) {
			this.refreshData();
		}
	},

	setLoading: function(inLoading) {
		this.loading = inLoading;
		this.$.iconMain.addRemoveClass("loading", inLoading);
	},

	refreshData: function() {
		var loc = this.activeLoc();
		this.setLoading(true);
		if (loc.gps) {
			this.$.statusLine3.setContent($L("Getting location..."));
			this.$.deviceLocation.locate();
		} else {
			this.fetchForecast(loc);
		}
	},

	located: function(inSender, inEvent) {
		var loc = this.prefs.locs[0];
		// Only look the name up again after moving a few km; Nominatim asks
		// apps to keep requests few.
		var moved = loc.lat === null || Math.abs(loc.lat - inEvent.lat) > 0.03 || Math.abs(loc.lon - inEvent.lon) > 0.03;
		loc.lat = inEvent.lat;
		loc.lon = inEvent.lon;
		this.savePrefs();
		if (moved || !loc.name) {
			this.lookUpPlaceName(loc);
		}
		if (this.activeLoc().gps) {
			this.fetchForecast(loc);
		}
	},

	locationFailed: function(inSender, inEvent) {
		var loc = this.prefs.locs[0];
		if (loc.lat !== null) {
			// The last known position beats no forecast at all.
			this.fetchForecast(loc, $L("Location unavailable; showing the forecast for the last known position."));
		} else {
			this.setLoading(false);
			this.$.statusLine2.setContent($L("Location unavailable"));
			this.$.statusLine3.setContent("");
			this.warn($L("Could not find your location. Turn on location services, or add a place in the menu (swipe left)."));
		}
	},

	lookUpPlaceName: function(inLoc) {
		WeatherNet.getJson(WeatherData.reverseUrl(inLoc.lat, inLoc.lon, this.lang), enyo.bind(this, function(inError, inJson) {
			if (inError || this.destroyed) {
				return;
			}
			var place = WeatherData.mapReverse(inJson);
			if (place.name) {
				var unitsBefore = this.unitsFor(inLoc);
				inLoc.name = place.name;
				inLoc.country = place.country;
				this.savePrefs();
				this.populateLocations();
				if (this.activeLoc() === inLoc) {
					this.$.statusLine1.setContent(place.name);
					// A first fix in a Fahrenheit country changes the units.
					if (this.unitsFor(inLoc) !== unitsBefore) {
						this.fetchForecast(inLoc);
					}
				}
			}
		}));
	},

	//* inNotice stays visible after a successful load (e.g. "last known position").
	fetchForecast: function(inLoc, inNotice) {
		var units = this.unitsFor(inLoc);
		var token = this.fetchToken = (this.fetchToken || 0) + 1;
		this.setLoading(true);
		this.$.statusLine3.setContent($L("Updating..."));
		WeatherNet.getJson(WeatherData.forecastUrl(inLoc.lat, inLoc.lon, units), enyo.bind(this, function(inError, inJson) {
			if (token !== this.fetchToken || this.destroyed) {
				return;
			}
			this.setLoading(false);
			if (inError) {
				var cached = WeatherStore.getForecast(inLoc);
				this.warn((inNotice ? inNotice + " " : "") +
					(inError.offline ? $L("No connection.") : $L("Forecast unavailable:") + " " + inError.message) +
					(cached ? " " + $L("Showing the forecast from") + " " + this.ageText(cached.time) + "." : ""));
				this.showUpdated(cached && cached.time);
				return;
			}
			WeatherStore.putForecast(inLoc, units, inJson);
			this.loadedAt = new Date().getTime();
			this.warn(inNotice || "");
			this.showForecast(inJson, units);
			this.showUpdated(this.loadedAt);
		}));
	},

	showCached: function() {
		var loc = this.activeLoc();
		this.$.statusLine1.setContent(loc.name || (loc.gps ? $L("Current Location") : ""));
		var cached = WeatherStore.getForecast(loc);
		if (cached && cached.json) {
			this.showForecast(cached.json, cached.units);
			this.showUpdated(cached.time);
		}
	},

	showUpdated: function(inTime) {
		this.$.statusLine3.setContent(inTime ? $L("Updated") + " " + this.ageText(inTime) : "");
	},

	//* "just now", "12 min ago", "3 h ago"
	ageText: function(inTime) {
		var mins = Math.round((new Date().getTime() - inTime) / 60000);
		if (mins < 2) {
			return $L("just now");
		}
		if (mins < 90) {
			return mins + " " + $L("min ago");
		}
		return Math.round(mins / 60) + " " + $L("h ago");
	},

	warn: function(inText) {
		this.$.sysWarning.setContent(inText);
		this.$.sysWarning.setShowing(!!inText);
	},

	// --- Rendering -------------------------------------------------------

	esc: function(inText) {
		return enyo.dom.escape(inText === undefined || inText === null ? "" : String(inText));
	},

	unit: function(inText) {
		return "<span class='label-units'>" + this.esc(inText) + "</span>";
	},

	//* {time, suffix} -> "8:02<span>am</span>"
	clockHtml: function(inClock) {
		return this.esc(inClock.time) + (inClock.suffix ? this.unit(inClock.suffix) : "");
	},

	valueHtml: function(inValue, inUnit) {
		return inValue === null || inValue === undefined ? "–" : this.esc(inValue) + this.unit(inUnit);
	},

	iconUrl: function(inSize, inIcon) {
		return "url('assets/icons/" + this.prefs.icons + "/icon" + inSize + "/" + inIcon + ".png')";
	},

	showForecast: function(inJson, inUnits) {
		this.lastJson = inJson;
		this.lastUnits = inUnits;
		var m = WeatherData.model(inJson, inUnits, this.is24h());
		var u = m.unitLabels, c = m.current;
		var loc = this.activeLoc();

		this.applyStyle("background-image", "url('assets/backgrounds/" + WeatherData.background(c.icon) + ".jpg')");

		// Header
		this.$.iconMain.applyStyle("background-image", this.iconUrl(64, c.icon));
		this.$.currentTemp.setContent(c.temp === null ? "--&deg;" : this.esc(c.temp) + "&deg;");
		this.$.statusLine1.setContent(loc.name || (loc.gps ? $L("Current Location") : ""));
		this.$.statusLine2.setContent(c.text);

		// Currently
		this.$.summaries.show();
		this.$.yourHour.setContent(m.summary.hour);
		this.$.yourDay.setContent(m.summary.day);
		this.$.yourWeek.setContent(m.summary.week);

		var icons = this.prefs.icons;
		var gust = c.windGust !== null && c.windGust > c.windSpeed + 5 ? " (" + this.esc(c.windGust) + ")" : "";
		this.$.elePrecip.setDesc(this.esc(c.precip));
		this.$.eleCloud.setDesc(this.valueHtml(c.cloud, "%"));
		this.$.eleWind.setDesc(this.esc(c.windDir) + (c.windSpeed ? " " + this.esc(c.windSpeed) + gust + this.unit(u.wind) : ""));
		this.$.eleVis.setDesc(this.valueHtml(c.visibility, u.distance));
		this.$.eleUv.setDesc(c.uv === null ? "–" : $L("UV") + " " + this.esc(c.uv));
		this.$.eleSun.setDesc(m.sunrise.time ? this.clockHtml(m.sunrise) : "–");
		this.$.eleMoon.setDesc(m.sunset.time ? this.clockHtml(m.sunset) : "–");
		this.$.eleHumid.setDesc(this.valueHtml(c.humidity, "%"));
		this.$.eleBaro.setDesc(this.valueHtml(c.pressure, u.pressure));
		this.$.eleFeels.setDesc(c.feels === null ? "–" : this.esc(c.feels) + "&deg;");
		var elements = ["elePrecip", "eleCloud", "eleWind", "eleVis", "eleUv", "eleSun", "eleMoon", "eleHumid", "eleBaro", "eleFeels"];
		for (var e = 0; e < elements.length; e++) {
			this.$[elements[e]].setPack(icons);
		}

		// Hourly
		this.$.hourlyContainer.destroyClientControls();
		for (var i = 0; i < m.hours.length; i++) {
			var h = m.hours[i];
			if (h.newDay) {
				this.$.hourlyContainer.createComponent({classes: "c-title day-divider", content: h.newDay}, {owner: this});
			}
			this.$.hourlyContainer.createComponent({kind: "HourlyForecastRow", pack: icons, icon: h.icon,
				hour: this.clockHtml(h.hour),
				forecast: (h.temp === null ? "" : this.esc(h.temp) + "&deg; ") + this.esc(h.text),
				precip: this.esc(h.precipProb) + this.unit("%"),
				cloud: this.valueHtml(h.cloud, "%")}, {owner: this});
		}
		this.$.hourlyContainer.createComponent({style: "height: 60px;"}, {owner: this});

		// Daily
		this.$.dailyContainer.destroyClientControls();
		for (var j = 0; j < m.days.length; j++) {
			var d = m.days[j];
			this.$.dailyContainer.createComponent({kind: "DailyForecastRow", pack: icons, icon: d.icon,
				high: d.high === null ? "–" : this.esc(d.high) + "&deg;",
				low: d.low === null ? "–" : this.esc(d.low) + "&deg;",
				date: d.label, forecast: d.forecast}, {owner: this});
		}
		this.$.dailyContainer.createComponent({style: "height: 60px;"}, {owner: this});

		this.$.hourlyContainer.render();
		this.$.dailyContainer.render();
	},

	// --- Panels / navigation ---------------------------------------------

	panelChanged: function(inSender, inEvent) {
		if (inEvent.fromIndex === 4) {
			this.closeSearch();
		}
		if (!this.prefs.animations) {
			return;
		}
		// Blur the panels to the left of the one in front, as Dash Weather did.
		var tabs = ["tabCurrently", "tabHourly", "tabDaily"];
		var containers = ["currentlyContainer", "hourlyContainer", "dailyContainer"];
		for (var i = 0; i < tabs.length; i++) {
			var blurred = inEvent.toIndex > i + 1;
			this.$[tabs[i]].addRemoveClass("blur-panel", blurred);
			this.$[containers[i]].addRemoveClass("blur-panel-content", blurred);
		}
	},

	/**
		Back from any other panel returns to Currently; from Currently, the
		system minimises the card. webos-lib's BackGesture sends this for the
		back gesture and for ESC on a desktop keyboard.
	*/
	backGesture: function(inSender, inEvent) {
		var index = this.$.panels.getIndex();
		if (index > 1) {
			this.$.panels.setIndex(index === 4 && this.$.searchRow.getShowing() ? 4 : 1);
			if (index === 4) {
				this.closeSearch();
			}
			if (inEvent && inEvent.preventDefault) {
				inEvent.preventDefault();
			}
			return true;
		}
	},

	showHelpBoxes: function() {
		this.$.helpSettings.applyStyle("display", "block");
		this.$.helpIcons.applyStyle("display", "block");
	},

	closeHelpBox: function(inSender) {
		inSender.applyStyle("display", "none");
	},

	openOpenMeteo: function() {
		window.open("https://open-meteo.com/");
	}
});
