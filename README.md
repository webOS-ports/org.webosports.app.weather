Weather
=======

The LuneOS weather app. It is based on
[Dash Weather+](https://github.com/garredow/dash-weather) by Garrett Downs
(Apache 2.0), keeps its look, and now uses services that still exist.

What changed from Dash Weather+
-------------------------------

- **Forecasts come from [Open-Meteo](https://open-meteo.com)**, which is
  keyless (data CC BY 4.0). Forecast.io / Dark Sky shut down in 2023, which
  left the original with no data.
- **"Your Hour / Day / Week" are written by the app.** Dark Sky used to
  supply these sentences. They are now built from the 15-minute, hourly and
  daily data, e.g. "Rain starting in about 45 min."
- **Place search and names no longer use Google.** Search uses Open-Meteo's
  geocoder, with OpenStreetMap Nominatim as a fallback for names typed
  without diacritics ("Tromso" → Tromsø). The name of the GPS position comes
  from Nominatim and is looked up again only after moving a few km.
- **Location** comes from the LuneOS location service
  (com.webos.service.location). It falls back to legacy com.palm.location,
  then to the last known position.
- **The last forecast is cached per place.** The card is never empty, and
  offline it shows the cached forecast with its age.
- **More forecast:** 48 hours (with day dividers) and 10 days. The day
  lines show chance and amount of precipitation, strong gusts and high UV.
  "Right Now" adds UV index and feels-like temperature.
- **Units** "Auto" follows the place: °F for US places, °C elsewhere.
  Imperial shows pressure in inHg and visibility in miles.
- **Time** "Auto" follows Settings > Date & Time (the system `timeFormat`).
- **Settings apply as soon as they are picked**; there is no Save button.
  Places get a visible × to remove them.
- **Refresh:** tap the weather icon. The forecast also refreshes when the
  card comes back after 30 minutes. The back gesture returns to Currently.
- **Everything shown from the network is escaped.**
- **The notification-area widget is back** (Menu > Settings > Widget: Off,
  Compact or Hourly). Compact is one dashboard row: icon, temperature,
  place, conditions and today's high/low. Hourly adds the next six hours.
  - Tap it to bring the app forward. Tap its icon to refresh.
  - It shows the app's place and cached forecast, and updates the moment
    the app stores a newer one.
  - While shown it refreshes a forecast older than 30 minutes, by
    coordinates only; it never starts the GPS.
  - It reopens when the app starts. It is opened as a LuneOS dashboard with
    `dashheight` in grid units. The shell reads `LuneOS_dashheight` in lower
    case, so Dash Weather's `dashHeight` would have been ignored.
- **Removed:** the Chrome extension, the Firefox OS manifest and the
  demo/API-key mode.

Layout
------

    appinfo.json, index.html     the app; index.html loads the minified build/,
                                 debug.html loads the sources
    source/WeatherData.js        pure: URLs, Open-Meteo -> view model, summaries, places
    source/Store.js              preferences, places, cached forecasts (localStorage)
    source/Net.js                JSON GET with timeout
    source/DeviceLocation.js     where the device is (luna / navigator.geolocation)
    source/App.js                the view (Dash Weather's panels)
    source/Widget.js, Widget.css the notification-area widget; widget.html loads it
    source/*Row.js, CurrentlyElement.js, TabIndicator.js   Dash Weather's parts
    enyo/, lib/                  Enyo 2.5.1 with layout, onyx, webos-lib (as in
                                 org.webosports.app.memos) and mochi 2.5.1
    tools/                       tests, build, deploy

Tests
-----

    tools/run-tests.sh [--built] [--live] [--screenshots]

This runs:
- unit tests of the data layer
- end-to-end tests of the real app in headless Chromium, with webOS, GPS
  and all web services mocked (offline)
- with `--built`, the same end-to-end tests on the minified build
- with `--live`, a short check against the real services

See [tools/tests/README.md](tools/tests/README.md) for the framework and its
mock.

Build and install
-----------------

    tools/build-ipk.sh     # -> deploy/org.webosports.app.weather_<version>_all.ipk
    tools/deploy.sh        # adb push to /usr/palm/applications + launcher rescan

Credits
-------

- Original app, design, icons and background photos: Garrett Downs,
  Dash Weather+ (Apache 2.0). The repository does not say where the
  background photos come from.
- Forecasts: [Open-Meteo.com](https://open-meteo.com), CC BY 4.0.
- Place search: GeoNames via Open-Meteo, and
  © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
  via Nominatim.
- Mochi and Enyo: Apache 2.0. Lato font in Mochi: SIL OFL.
