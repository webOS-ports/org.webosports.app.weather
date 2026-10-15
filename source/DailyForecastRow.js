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

	Modified for LuneOS by WebOS Ports, 2026: the icon pack is a property
	instead of a global; text arrives as escaped HTML from the app.
*/

enyo.kind({
	name: "DailyForecastRow",
	kind: "FittableColumns",
	classes: "day-box",
	published: {
		date: "",
		icon: "na",
		high: "",
		low: "",
		forecast: "",
		pack: "optIconsColor"
	},
	components: [
		{name: "icon", classes: "icon"},
		{kind: "FittableRows", components: [
			{name: "high", classes: "high", allowHtml: true},
			{name: "low", classes: "low", allowHtml: true}
		]},
		{kind: "FittableRows", fit: true, components: [
			{name: "date", classes: "date"},
			{name: "forecast", classes: "forecast"}
		]}
	],
	rendered: function() {
		this.inherited(arguments);
		this.$.icon.applyStyle("background-image", "url('assets/icons/" + this.pack + "/icon64/" + this.icon + ".png')");
		this.$.high.setContent(this.high);
		this.$.low.setContent(this.low);
		this.$.date.setContent(this.date);
		this.$.forecast.setContent(this.forecast);
	}
});
