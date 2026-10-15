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
	instead of a global, and values are set as escaped HTML by the app.
*/

enyo.kind({
	name: "CurrentlyElementL",
	kind: "FittableColumns",
	classes: "currently-element left",
	published: {
		icon: "na",
		//* HTML; the app escapes what it puts in.
		desc: "–",
		pack: "optIconsColor"
	},
	components: [
		{name: "icon", classes: "icon"},
		{name: "desc", classes: "desc", allowHtml: true}
	],
	rendered: function() {
		this.inherited(arguments);
		this.iconChanged();
		this.descChanged();
	},
	iconChanged: function() {
		this.$.icon.applyStyle("background-image", "url('assets/icons/" + this.pack + "/icon24/" + this.icon + ".png')");
	},
	packChanged: function() {
		this.iconChanged();
	},
	descChanged: function() {
		this.$.desc.setContent(this.desc);
	}
});

enyo.kind({
	name: "CurrentlyElementR",
	kind: "FittableColumns",
	classes: "currently-element right",
	published: {
		icon: "na",
		//* HTML; the app escapes what it puts in.
		desc: "–",
		pack: "optIconsColor"
	},
	components: [
		{name: "desc", classes: "desc", allowHtml: true},
		{name: "icon", classes: "icon"}
	],
	rendered: function() {
		this.inherited(arguments);
		this.iconChanged();
		this.descChanged();
	},
	iconChanged: function() {
		this.$.icon.applyStyle("background-image", "url('assets/icons/" + this.pack + "/icon24/" + this.icon + ".png')");
	},
	packChanged: function() {
		this.iconChanged();
	},
	descChanged: function() {
		this.$.desc.setContent(this.desc);
	}
});
