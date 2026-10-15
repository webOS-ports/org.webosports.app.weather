/*
	One JSON GET with a timeout, and failures turned into something the view
	can explain. A bare XMLHttpRequest keeps the timeout and the error shape
	in one place; enyo.Ajax would also append a cache-busting parameter to
	every URL. Cross-origin calls work on the device because WAM runs web
	apps with --disable-web-security; Open-Meteo and Nominatim also send
	CORS headers, so a desktop browser works too.
*/
var WeatherNet = {
	timeout: 20000,

	/**
		inDone(error, json). error is null, or {offline: bool, status: n,
		message} for the view to explain.
	*/
	getJson: function(inUrl, inDone) {
		var xhr = new XMLHttpRequest();
		var finished = false;
		var finish = function(inError, inJson) {
			if (!finished) {
				finished = true;
				inDone(inError, inJson);
			}
		};
		var timer = setTimeout(function() {
			xhr.abort();
			finish({offline: true, status: 0, message: "timeout"});
		}, this.timeout);
		xhr.onreadystatechange = function() {
			if (xhr.readyState !== 4) {
				return;
			}
			clearTimeout(timer);
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					finish(null, JSON.parse(xhr.responseText));
				} catch (e) {
					finish({offline: false, status: xhr.status, message: "bad JSON"});
				}
			} else {
				var reason = "";
				try {
					reason = JSON.parse(xhr.responseText).reason || "";
				} catch (e2) {}
				finish({offline: xhr.status === 0, status: xhr.status, message: reason || ("HTTP " + xhr.status)});
			}
		};
		try {
			xhr.open("GET", inUrl, true);
			xhr.send(null);
		} catch (e3) {
			clearTimeout(timer);
			finish({offline: true, status: 0, message: String(e3)});
		}
		return xhr;
	}
};
