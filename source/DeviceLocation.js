/*
	Where the device is, once, for the "Current Location" place.

	Follows the LuneOS Maps app (org.webosports.app.maps,
	source/data/webOSGeolocation.js): on LuneOS ask the webOS OSE location
	service, cached fix first, then the first live update; on legacy webOS
	ask com.palm.location; in a desktop browser use navigator.geolocation.

	A city-level answer is all weather needs, so a cached fix of any age is
	taken as is, and nothing keeps the GPS running after the first fix.
*/
enyo.kind({
	name: "DeviceLocation",
	kind: "enyo.Component",

	events: {
		//* {lat, lon}
		onLocated: "",
		//* {message}
		onLocationFailed: ""
	},

	//* Give up after this long, in ms; the app then uses the last known place.
	timeout: 25000,

	components: [
		{name: "cached", kind: "enyo.PalmService", service: "luna://com.webos.service.location/",
			method: "getCachedPosition", onResponse: "gotFix", onError: "cachedFailed"},
		{name: "updates", kind: "enyo.PalmService", service: "luna://com.webos.service.location/",
			method: "getLocationUpdates", subscribe: true, onResponse: "gotFix", onError: "updatesFailed"},
		{name: "legacy", kind: "enyo.PalmService", service: "palm://com.palm.location/",
			method: "getCurrentPosition", onResponse: "gotFix", onError: "failed"}
	],

	locate: function() {
		this.cancel();
		this.pending = true;
		this.timer = setTimeout(enyo.bind(this, function() {
			this.fail("No location fix within " + Math.round(this.timeout / 1000) + " seconds.");
		}), this.timeout);
		if (window.PalmSystem) {
			this.$.cached.send({});
		} else if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition(enyo.bind(this, function(inPos) {
				this.succeed(inPos.coords.latitude, inPos.coords.longitude);
			}), enyo.bind(this, function(inError) {
				this.fail(inError && inError.message || "Location unavailable.");
			}), {maximumAge: 30 * 60000, timeout: this.timeout, enableHighAccuracy: false});
		} else {
			this.fail("No location service.");
		}
	},

	cancel: function() {
		clearTimeout(this.timer);
		this.pending = false;
		if (this.updateRequest) {
			this.updateRequest.cancel();
			this.updateRequest = null;
		}
	},

	gotFix: function(inSender, inEvent) {
		var d = inEvent.data || {};
		// Subscription acknowledgements carry no position.
		if (d.latitude === undefined) {
			return;
		}
		this.succeed(d.latitude, d.longitude);
	},

	isUnknownService: function(inData) {
		return /Unknown (service|method)|not (found|running)/i.test((inData && inData.errorText) || "");
	},

	cachedFailed: function(inSender, inEvent) {
		if (this.isUnknownService(inEvent.data)) {
			this.$.legacy.send({accuracy: 3, maximumAge: 1800, responseTime: 2});
			return;
		}
		// No cached fix yet: the first live update answers instead.
		this.updateRequest = this.$.updates.send({subscribe: true, minimumInterval: 1000});
	},

	updatesFailed: function(inSender, inEvent) {
		if (this.isUnknownService(inEvent.data)) {
			this.$.legacy.send({accuracy: 3, maximumAge: 1800, responseTime: 2});
			return;
		}
		this.failed(inSender, inEvent);
	},

	failed: function(inSender, inEvent) {
		var d = inEvent.data || {};
		this.fail(d.errorText || ("Location error " + d.errorCode));
	},

	succeed: function(inLat, inLon) {
		if (!this.pending) {
			return;
		}
		this.cancel();
		this.doLocated({lat: inLat, lon: inLon});
	},

	fail: function(inMessage) {
		if (!this.pending) {
			return;
		}
		this.cancel();
		this.doLocationFailed({message: inMessage});
	},

	destroy: function() {
		this.cancel();
		this.inherited(arguments);
	}
});
