let electron = require("electron");
var ASSET_CHANNELS = {
	write: "noto:v1:assets:write",
	/** Pick a picture with the system dialog and copy it in, for the menu. */
	pick: "noto:v1:assets:pick"
};
//#endregion
//#region src/shared/assets/v1/validate.ts
/**
* Both sides of the asset boundary check the same messages here.
*
* Same discipline as the workspace and settings validators: the key set is
* exact, so a message carrying anything extra is refused rather than having the
* extra quietly ignored. The bytes are the one field that is large, and the
* ceiling is checked here as well as in main, because a request that is going
* to be refused should not be copied across the boundary first.
*/
var requestId$3 = /^[A-Za-z0-9_-]{1,96}$/;
var record$3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var exact$2 = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => key in value);
function isAssetRequestV1(value) {
	return record$3(value) && exact$2(value, ["version", "requestId"]) && value.version === 1 && typeof value.requestId === "string" && requestId$3.test(value.requestId);
}
function isAssetWriteRequestV1(value) {
	if (!record$3(value) || !exact$2(value, [
		"version",
		"requestId",
		"bytes"
	])) return false;
	if (value.version !== 1) return false;
	if (typeof value.requestId !== "string" || !requestId$3.test(value.requestId)) return false;
	if (!(value.bytes instanceof Uint8Array)) return false;
	return value.bytes.byteLength > 0 && value.bytes.byteLength <= 20971520;
}
var REFUSALS = /* @__PURE__ */ new Set([
	"no-document",
	"unsupported-type",
	"too-large",
	"outside-root",
	"cancelled",
	"write-failed"
]);
function isAssetWriteReplyV1(value) {
	if (!record$3(value) || value.version !== 1) return false;
	if (value.written === true) return exact$2(value, [
		"version",
		"written",
		"reference",
		"url",
		"alt"
	]) && typeof value.reference === "string" && value.reference.length > 0 && typeof value.url === "string" && typeof value.alt === "string";
	return value.written === false && exact$2(value, [
		"version",
		"written",
		"reason"
	]) && typeof value.reason === "string" && REFUSALS.has(value.reason);
}
function isAssetResultV1(value, expectedRequestId) {
	if (!record$3(value) || value.requestId !== expectedRequestId) return false;
	if (value.ok === true) return isAssetWriteReplyV1(value.value);
	return value.ok === false && record$3(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}
//#endregion
//#region src/shared/ipc/contracts.ts
var IPC_CHANNELS = {
	service: "noto:v1:service",
	diagnostics: "noto:v1:diagnostics",
	pluginLifecycle: "noto:v1:plugins:lifecycle",
	pluginSnapshots: "noto:v1:plugins:snapshots",
	pluginRendererRequest: "noto:v1:plugins:renderer-request",
	pluginRendererAck: "noto:v1:plugins:renderer-ack",
	pluginRendererReady: "noto:v1:plugins:renderer-ready"
};
//#endregion
//#region src/shared/settings/v1/contracts.ts
var SETTINGS_CHANNELS = {
	read: "noto:v1:settings:read",
	write: "noto:v1:settings:write",
	changed: "noto:v1:settings:changed",
	/** Reads the stylesheet at `customCssPath`. Main owns the path; the renderer
	*  never names a file, so this cannot be pointed at anything else. */
	themeCss: "noto:v1:settings:theme-css"
};
/**
* Numeric settings, with the range each one is clamped to.
*
* Bounds rather than free numbers because these reach CSS: a line height of 40
* or a text size of 400 does not produce an unusual document, it produces an
* unusable window with no way back except editing the settings file by hand.
* The floor is as important as the ceiling for the same reason.
*/
var SETTING_RANGES = Object.freeze({
	fontSize: {
		min: 13,
		max: 26,
		step: 1
	},
	lineHeight: {
		min: 1.3,
		max: 2.2,
		step: .02
	},
	autoSaveDelayMs: {
		min: 400,
		max: 1e4,
		step: 100
	},
	railWidth: {
		min: 190,
		max: 520,
		step: 1
	}
});
/**
* The three widths of the writing column, in the order `Cmd+]` walks them.
*
* Modes rather than a number, because the width is not a number the reader
* owns: it is a share of whatever canvas is left beside the rail, capped so a
* paragraph never runs across a 27-inch display. The share and the cap for each
* mode live in the stylesheet, where the canvas width is known, and each one is
* `min(canvas - gutters, cap)`. That last clause is the rule the whole thing
* exists for: the column is never wider than the canvas it sits in, so the
* document never scrolls sideways, whatever the mode and however narrow the
* window.
*
* `default` is the reading column, up to 860px, which is the width of Typora's
* own page. `wide` is 78% of the canvas held between 1000px and 1180px, for a
* code block that runs past the reading column. `full` is everything beside
* the rail, up to 1680px. Ported from the author's `wider` plugin for Typora,
* whose numbers were tuned against a real vault.
*/
var WIDTH_MODES = [
	"default",
	"wide",
	"full"
];
/**
* Where a pasted or dropped picture is put, which is the only choice in the
* image pane that changes what lands in the vault.
*
* Typora offers the same four and its own default is `assets`, a folder beside
* the note. That is the one that keeps a note portable: the note and its
* pictures move together, and nothing lands loose in the folder the reader is
* looking at. `note-assets` is the same idea with a folder per note, for a
* vault where one note owns forty screenshots. `folder` writes beside the note.
* `custom` is for a vault that already has a pictures folder and wants it used.
*/
var IMAGE_DESTINATIONS = [
	"assets",
	"note-assets",
	"folder",
	"custom"
];
var DEFAULT_SETTINGS = Object.freeze({
	theme: "system",
	fontSize: 15,
	lineHeight: 1.58,
	widthMode: "default",
	smartQuotes: true,
	smartDashes: true,
	smartEllipsis: true,
	spellCheck: true,
	remoteImages: true,
	codeLineNumbers: true,
	codeIndentGuides: true,
	autoPair: true,
	focusMode: false,
	typewriterMode: false,
	sidebarOnLaunch: false,
	railWidth: 272,
	autoSave: false,
	autoSaveDelayMs: 1200,
	customCssPath: "",
	imageDestination: "assets",
	imageCustomFolder: "./images",
	imageEscapeUrl: true
});
//#endregion
//#region src/shared/settings/v1/validate.ts
/**
* Settings validation.
*
* A settings file is user-writable and survives upgrades, so it is exactly the
* kind of input that arrives malformed. Every field is checked individually and
* an unusable one falls back to its default rather than failing the whole read,
* because losing one preference is better than starting with none.
*/
var requestId$2 = /^[A-Za-z0-9._:-]{1,96}$/;
var themes = [
	"light",
	"dark",
	"system"
];
var isWidthMode = (value) => WIDTH_MODES.includes(value);
var numericKeys = Object.keys(SETTING_RANGES);
var isNumericKey = (key) => numericKeys.includes(key);
/**
* A stylesheet path.
*
* Absolute, because a relative one is resolved against whatever the process
* happens to consider its working directory. Bounded, and free of the NUL and
* newline that would let a path smuggle a second argument into anything that
* later logs or shells it.
*/
var isCssPath = (value) => typeof value === "string" && value.length <= 1024 && !/[\0\r\n]/.test(value) && (value === "" || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value));
/**
* The custom folder a picture is copied into.
*
* Relative to the note, or absolute. The traversal check here is not the guard:
* main resolves the folder and refuses anything that does not land inside a
* root it already trusts, which is the check that matters because it follows
* symbolic links. This one refuses the obvious case at the boundary so a
* setting that could never work is not stored in the first place.
*/
var isImageFolder = (value) => typeof value === "string" && value.length <= 512 && !/[\0\r\n]/.test(value) && !value.split(/[\\/]/).includes("..");
var record$2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
/**
* A patch from the renderer.
*
* Stricter than a read: an unknown key or a wrong type is rejected outright
* rather than dropped, because a write that silently does nothing is worse than
* one that reports failure.
*/
function isSettingsWriteRequestV1(value) {
	if (!record$2(value) || value.version !== 1 || typeof value.requestId !== "string" || !requestId$2.test(value.requestId) || !record$2(value.patch)) return false;
	const patch = value.patch;
	const keys = Object.keys(patch);
	if (keys.length === 0 || keys.length > SETTING_KEYS.length) return false;
	return keys.every((key) => {
		if (!SETTING_KEYS.includes(key)) return false;
		if (key === "theme") return themes.includes(patch.theme);
		if (key === "widthMode") return isWidthMode(patch.widthMode);
		if (key === "customCssPath") return isCssPath(patch.customCssPath);
		if (key === "imageDestination") return IMAGE_DESTINATIONS.includes(patch.imageDestination);
		if (key === "imageCustomFolder") return isImageFolder(patch.imageCustomFolder);
		if (isNumericKey(key)) {
			const candidate = patch[key];
			const range = SETTING_RANGES[key];
			return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= range.min && candidate <= range.max;
		}
		return typeof patch[key] === "boolean";
	});
}
function isSettingsRequestV1(value) {
	return record$2(value) && value.version === 1 && Object.keys(value).length === 2 && typeof value.requestId === "string" && requestId$2.test(value.requestId);
}
function isSettingsReplyV1(value) {
	if (!record$2(value) || value.version !== 1 || !record$2(value.settings)) return false;
	const settings = value.settings;
	return themes.includes(settings.theme) && isWidthMode(settings.widthMode) && numericKeys.every((key) => typeof settings[key] === "number" && Number.isFinite(settings[key])) && typeof settings.smartQuotes === "boolean" && typeof settings.smartDashes === "boolean" && typeof settings.smartEllipsis === "boolean" && typeof settings.spellCheck === "boolean" && typeof settings.remoteImages === "boolean" && typeof settings.codeLineNumbers === "boolean" && typeof settings.codeIndentGuides === "boolean" && typeof settings.autoPair === "boolean" && typeof settings.focusMode === "boolean" && typeof settings.typewriterMode === "boolean" && typeof settings.sidebarOnLaunch === "boolean" && typeof settings.autoSave === "boolean" && typeof settings.imageEscapeUrl === "boolean" && IMAGE_DESTINATIONS.includes(settings.imageDestination) && isImageFolder(settings.imageCustomFolder) && isCssPath(settings.customCssPath);
}
function isSettingsResultV1(value, expectedRequestId) {
	if (!record$2(value) || value.requestId !== expectedRequestId) return false;
	if (value.ok === true) return isSettingsReplyV1(value.value);
	return value.ok === false && record$2(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}
function isThemeCssReplyV1(value) {
	return record$2(value) && value.version === 1 && typeof value.css === "string" && typeof value.problem === "string";
}
function isThemeCssResultV1(value, expectedRequestId) {
	if (!record$2(value) || value.requestId !== expectedRequestId) return false;
	if (value.ok === true) return isThemeCssReplyV1(value.value);
	return value.ok === false && record$2(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}
//#endregion
//#region src/shared/file-truth/v1/contracts.ts
var FILE_TRUTH_CHANNELS = {
	bootstrap: "noto:file-truth:v1:bootstrap",
	open: "noto:file-truth:v1:open",
	save: "noto:file-truth:v1:save",
	saveCopy: "noto:file-truth:v1:save-copy",
	recover: "noto:file-truth:v1:recover",
	diagnostics: "noto:file-truth:v1:diagnostics"
};
//#endregion
//#region src/shared/errors.ts
var NOTO_ERROR_CODES = [
	"BAD_REQUEST",
	"BOOTSTRAP_FAILED",
	"CAPABILITY_DENIED",
	"DOCUMENT_NOT_OPEN",
	"EDITOR_FAILED",
	"IPC_SENDER_REJECTED",
	"OPEN_FAILED",
	"PLUGIN_FAILED",
	"PLUGIN_UNKNOWN",
	"PLUGIN_STALE",
	"PLUGIN_NOT_HYDRATED",
	"PLUGIN_CLEANUP_FAILED",
	"PLUGIN_GENERATION_FAILED",
	"PLUGIN_RENDERER_DISPOSED",
	"SAVE_FAILED",
	"SEMANTIC_MISMATCH",
	"SERVICE_FAILED",
	"SERVICE_CANCELLED",
	"SERVICE_STOPPED",
	"SOURCE_MAP_UNSUPPORTED",
	"STRUCTURE_CHANGED",
	"TEST_MODE_REQUIRED",
	"TIMEOUT"
];
//#endregion
//#region src/shared/plugins/lifecycle.ts
var RENDERER_TRANSPORT_FAILURE_CODES = [
	"PLUGIN_FAILED",
	"PLUGIN_GENERATION_ABORTED",
	"PLUGIN_GENERATION_STALE",
	"PLUGIN_RENDERER_DISPOSED",
	"PLUGIN_RENDERER_UNAVAILABLE",
	"PLUGIN_RENDERER_DISPOSAL_FAILED",
	"PLUGIN_RENDERER_DISPOSAL_INCOMPLETE",
	"PLUGIN_LEASE_MISMATCH",
	"PLUGIN_LEASE_PLUGIN_MISMATCH",
	"PLUGIN_LEASE_INVALID",
	"PLUGIN_LEASE_REUSED",
	"PLUGIN_LEASE_CLOSED",
	"PLUGIN_LEASE_UNKNOWN",
	"PLUGIN_CAPABILITY_DENIED",
	"PLUGIN_DISPOSER_INVALID",
	"PLUGIN_MANIFEST_INVALID",
	"PLUGIN_REGISTRATION_DUPLICATE",
	"PLUGIN_REGISTRATION_UNDECLARED",
	"PLUGIN_REPLACEMENT_CLEANUP_FAILED",
	"PLUGIN_SETTING_INVALID",
	"PLUGIN_SETTING_UNKNOWN",
	"PLUGIN_SETTING_UNAVAILABLE"
];
function isRendererTransportFailureCode(value) {
	return typeof value === "string" && RENDERER_TRANSPORT_FAILURE_CODES.includes(value);
}
//#endregion
//#region src/shared/ipc/validate.ts
var requestIdPattern = /^[a-zA-Z0-9._:-]{1,96}$/;
var hashPattern = /^[a-f0-9]{64}$/;
var grantIdPattern = /^grant:[a-f0-9-]{36}$/;
var MAX_COUNTER = 1e6;
var lifecycleStates = [
	"discovered",
	"disabled",
	"enabled-idle",
	"activating",
	"active",
	"deactivating",
	"failed",
	"crashed"
];
var persistenceHealth = [
	"healthy",
	"degraded",
	"indeterminate"
];
var pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
var rendererSessionIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
var capabilityGrantStates = [
	"active",
	"revoking",
	"revoked"
];
var capabilityRequestStates = [
	"pending",
	"cancelling",
	"completed",
	"cancelled",
	"timed-out",
	"failed"
];
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, keys) {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function isBoundedString(value, max, allowEmpty = false) {
	return typeof value === "string" && value.length <= max && (allowEmpty || value.length > 0);
}
function isBoundedCounter(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_COUNTER;
}
function isGeneration(value) {
	return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_COUNTER;
}
function isNullableGeneration(value) {
	return value === null || isGeneration(value);
}
function isHash(value) {
	return typeof value === "string" && hashPattern.test(value);
}
function isNotoError(value) {
	return isRecord(value) && hasExactKeys(value, ["code", "message"]) && typeof value.code === "string" && NOTO_ERROR_CODES.includes(value.code) && isBoundedString(value.message, 2048);
}
function isRequestBase(value) {
	return isRecord(value) && hasExactKeys(value, ["version", "requestId"]) && value.version === 1 && typeof value.requestId === "string" && requestIdPattern.test(value.requestId);
}
function isPluginId(value) {
	return typeof value === "string" && value.length <= 80 && pluginIdPattern.test(value);
}
function isLeaseId(value) {
	return typeof value === "string" && /^lease:[a-zA-Z0-9._:-]{1,96}$/.test(value);
}
function isBooleanSettings(value) {
	return isRecord(value) && Object.keys(value).length <= 32 && Object.keys(value).every((key) => /^[a-z][a-zA-Z0-9.-]{0,79}$/.test(key)) && Object.values(value).every((setting) => typeof setting === "boolean");
}
function isActivationReason(value) {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (value.type === "startup") return hasExactKeys(value, ["type"]);
	if (value.type === "event") return hasExactKeys(value, ["type", "event"]) && isBoundedString(value.event, 80);
	if (value.type === "hotkey") return hasExactKeys(value, ["type", "keys"]) && isBoundedString(value.keys, 80);
	return value.type === "command" && hasExactKeys(value, ["type", "commandId"]) && isBoundedString(value.commandId, 80);
}
function isCapabilitySnapshot(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"grant",
		"request",
		"restartRequired"
	])) return false;
	const grant = value.grant;
	const request = value.request;
	const validGrant = grant === null || isRecord(grant) && hasExactKeys(grant, [
		"id",
		"generation",
		"root",
		"state"
	]) && typeof grant.id === "string" && grantIdPattern.test(grant.id) && isGeneration(grant.generation) && isBoundedString(grant.root, 256) && !/[\\/]/.test(grant.root) && capabilityGrantStates.includes(grant.state);
	const validRequest = request === null || isRecord(request) && hasExactKeys(request, [
		"requestId",
		"generation",
		"action",
		"state",
		"detail"
	]) && typeof request.requestId === "string" && requestIdPattern.test(request.requestId) && isGeneration(request.generation) && ["read-granted", "deny-probe"].includes(String(request.action)) && capabilityRequestStates.includes(request.state) && isBoundedString(request.detail, 512, true);
	return validGrant && validRequest && typeof value.restartRequired === "boolean";
}
function isPluginLifecycleSnapshot(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"id",
		"manifestVersion",
		"desiredEnabled",
		"lifecycle",
		"settings",
		"activeGeneration",
		"leaseCount",
		"rendererRegistrations",
		"activationReason",
		"persistenceHealth",
		"lastFailure",
		"capability"
	]) || !isPluginId(value.id) || !isBoundedString(value.manifestVersion, 256) || typeof value.desiredEnabled !== "boolean" || !lifecycleStates.includes(value.lifecycle) || !isBooleanSettings(value.settings) || !isNullableGeneration(value.activeGeneration) || !isBoundedCounter(value.leaseCount) || !isBoundedCounter(value.rendererRegistrations) || !(value.activationReason === null || isActivationReason(value.activationReason)) || !persistenceHealth.includes(value.persistenceHealth) || !(value.lastFailure === null || isBoundedString(value.lastFailure, 2048)) || !isCapabilitySnapshot(value.capability)) return false;
	return !Object.values(value.settings).some((setting) => typeof setting !== "boolean");
}
function isSnapshotList(value) {
	return Array.isArray(value) && value.length <= 64 && value.every(isPluginLifecycleSnapshot) && new Set(value.map((snapshot) => snapshot.id)).size === value.length;
}
function isPluginLifecycleRequest(value) {
	if (!isRecord(value) || value.version !== 1 || typeof value.requestId !== "string" || !requestIdPattern.test(value.requestId) || typeof value.action !== "string") return false;
	switch (value.action) {
		case "get-snapshots":
		case "trigger-startup": return hasExactKeys(value, [
			"version",
			"requestId",
			"action"
		]);
		case "enable":
		case "disable": return hasExactKeys(value, [
			"version",
			"requestId",
			"action",
			"pluginId"
		]) && isPluginId(value.pluginId);
		case "trigger-event": return hasExactKeys(value, [
			"version",
			"requestId",
			"action",
			"event"
		]) && isBoundedString(value.event, 80);
		case "trigger-hotkey": return hasExactKeys(value, [
			"version",
			"requestId",
			"action",
			"keys"
		]) && isBoundedString(value.keys, 80);
		case "execute-command": return hasExactKeys(value, [
			"version",
			"requestId",
			"action",
			"pluginId",
			"commandId"
		]) && isPluginId(value.pluginId) && isBoundedString(value.commandId, 80);
		case "set-setting": return hasExactKeys(value, [
			"version",
			"requestId",
			"action",
			"pluginId",
			"key",
			"value"
		]) && isPluginId(value.pluginId) && isBoundedString(value.key, 80) && typeof value.value === "boolean";
		case "replace-generation": return hasExactKeys(value, [
			"version",
			"requestId",
			"action",
			"pluginId",
			"reason"
		]) && isPluginId(value.pluginId) && isActivationReason(value.reason);
		case "renderer-disposed": return hasExactKeys(value, [
			"version",
			"requestId",
			"action",
			"pluginId",
			"leaseId",
			"generation"
		]) && isPluginId(value.pluginId) && isLeaseId(value.leaseId) && isGeneration(value.generation);
		default: return false;
	}
}
function isPluginLifecycleReply(value, action) {
	return isRecord(value) && hasExactKeys(value, [
		"version",
		"action",
		"snapshots",
		"handled"
	]) && value.version === 1 && value.action === action && isSnapshotList(value.snapshots) && (value.handled === null || typeof value.handled === "boolean");
}
function isPluginLifecycleResult(value, requestId, action) {
	return isTypedResult(value, requestId, (candidate) => isPluginLifecycleReply(candidate, action));
}
function isPluginSnapshotEvent(value) {
	return isRecord(value) && hasExactKeys(value, ["version", "snapshots"]) && value.version === 1 && isSnapshotList(value.snapshots);
}
function isRendererTransportBase(value) {
	return value.version === 1 && typeof value.requestId === "string" && requestIdPattern.test(value.requestId) && typeof value.rendererSessionId === "string" && rendererSessionIdPattern.test(value.rendererSessionId) && isPluginId(value.pluginId) && isLeaseId(value.leaseId) && isGeneration(value.generation);
}
function isRendererTransportRequest(value) {
	if (!isRecord(value) || !isRendererTransportBase(value)) return false;
	switch (value.action) {
		case "open": return hasExactKeys(value, [
			"version",
			"requestId",
			"rendererSessionId",
			"action",
			"pluginId",
			"leaseId",
			"generation",
			"settings"
		]) && isBooleanSettings(value.settings);
		case "close": return hasExactKeys(value, [
			"version",
			"requestId",
			"rendererSessionId",
			"action",
			"pluginId",
			"leaseId",
			"generation"
		]);
		case "execute-command": return hasExactKeys(value, [
			"version",
			"requestId",
			"rendererSessionId",
			"action",
			"pluginId",
			"leaseId",
			"generation",
			"commandId"
		]) && isBoundedString(value.commandId, 80);
		case "update-setting": return hasExactKeys(value, [
			"version",
			"requestId",
			"rendererSessionId",
			"action",
			"pluginId",
			"leaseId",
			"generation",
			"key",
			"value"
		]) && isBoundedString(value.key, 80) && typeof value.value === "boolean";
		default: return false;
	}
}
function isRendererTransportAck(value) {
	if (!isRecord(value) || !isRendererTransportBase(value) || typeof value.action !== "string" || typeof value.ok !== "boolean") return false;
	if (!value.ok) return hasExactKeys(value, [
		"version",
		"requestId",
		"rendererSessionId",
		"action",
		"ok",
		"pluginId",
		"leaseId",
		"generation",
		"error"
	]) && [
		"open",
		"close",
		"execute-command",
		"update-setting"
	].includes(value.action) && isRendererTransportFailureCode(value.error);
	if (value.action === "open") return hasExactKeys(value, [
		"version",
		"requestId",
		"rendererSessionId",
		"action",
		"ok",
		"pluginId",
		"leaseId",
		"generation",
		"registrations"
	]) && isBoundedCounter(value.registrations);
	if (value.action === "close") return hasExactKeys(value, [
		"version",
		"requestId",
		"rendererSessionId",
		"action",
		"ok",
		"pluginId",
		"leaseId",
		"generation",
		"complete",
		"failures",
		"registrations"
	]) && typeof value.complete === "boolean" && Array.isArray(value.failures) && value.failures.length <= 32 && value.failures.every(isRendererTransportFailureCode) && value.registrations === 0;
	if (value.action === "execute-command") return hasExactKeys(value, [
		"version",
		"requestId",
		"rendererSessionId",
		"action",
		"ok",
		"pluginId",
		"leaseId",
		"generation",
		"handled"
	]) && typeof value.handled === "boolean";
	return value.action === "update-setting" && hasExactKeys(value, [
		"version",
		"requestId",
		"rendererSessionId",
		"action",
		"ok",
		"pluginId",
		"leaseId",
		"generation"
	]);
}
function isRendererReadyMessage(value) {
	return isRecord(value) && hasExactKeys(value, ["version", "rendererSessionId"]) && value.version === 1 && typeof value.rendererSessionId === "string" && rendererSessionIdPattern.test(value.rendererSessionId);
}
function isServiceRequest(value) {
	if (!isRecord(value) || value.version !== 1 || typeof value.requestId !== "string" || !requestIdPattern.test(value.requestId) || !isGeneration(value.generation) || typeof value.action !== "string") return false;
	if (value.action === "grant-read") return hasExactKeys(value, [
		"version",
		"requestId",
		"generation",
		"action"
	]);
	if ([
		"read-granted",
		"deny-probe",
		"revoke-grant"
	].includes(value.action)) return hasExactKeys(value, [
		"version",
		"requestId",
		"generation",
		"action",
		"grantId"
	]) && typeof value.grantId === "string" && grantIdPattern.test(value.grantId);
	return value.action === "cancel-request" && hasExactKeys(value, [
		"version",
		"requestId",
		"generation",
		"action",
		"targetRequestId"
	]) && typeof value.targetRequestId === "string" && requestIdPattern.test(value.targetRequestId);
}
function isDiagnosticsRequest(value) {
	return isRequestBase(value);
}
function isServiceReply(value) {
	if (!isRecord(value) || !isGeneration(value.generation)) return false;
	if (value.state === "granted") return hasExactKeys(value, [
		"state",
		"grantId",
		"root",
		"generation"
	]) && typeof value.grantId === "string" && grantIdPattern.test(value.grantId) && isBoundedString(value.root, 256) && !/[\\/]/.test(value.root);
	if (value.state === "read") return hasExactKeys(value, [
		"state",
		"sha256",
		"size",
		"generation"
	]) && isHash(value.sha256) && isBoundedCounter(value.size);
	if (value.state === "revoked") return hasExactKeys(value, [
		"state",
		"grantId",
		"generation"
	]) && typeof value.grantId === "string" && grantIdPattern.test(value.grantId);
	return value.state === "cancelled" && hasExactKeys(value, [
		"state",
		"targetRequestId",
		"generation"
	]) && typeof value.targetRequestId === "string" && requestIdPattern.test(value.targetRequestId);
}
function isServiceOperationReply(value) {
	if (!isRecord(value) || ![
		"grant-read",
		"read-granted",
		"deny-probe",
		"revoke-grant",
		"cancel-request"
	].includes(String(value.action)) || !isPluginLifecycleSnapshot(value.snapshot)) return false;
	const { action: _action, snapshot: _snapshot, ...reply } = value;
	if (!isServiceReply(reply)) return false;
	if (value.action === "grant-read") return reply.state === "granted";
	if (value.action === "read-granted" || value.action === "deny-probe") return reply.state === "read";
	if (value.action === "revoke-grant") return reply.state === "revoked";
	return value.action === "cancel-request" && reply.state === "cancelled";
}
function isDiagnosticsReply(value) {
	if (!isRecord(value) || !hasExactKeys(value, ["renderer", "service"])) return false;
	const renderer = value.renderer;
	const service = value.service;
	return isRecord(renderer) && hasExactKeys(renderer, ["consoleErrors", "consoleWarnings"]) && isBoundedCounter(renderer.consoleErrors) && isBoundedCounter(renderer.consoleWarnings) && isRecord(service) && hasExactKeys(service, [
		"denials",
		"dispatched",
		"failures",
		"grants",
		"received",
		"generation",
		"state",
		"permissionProbe"
	]) && isBoundedCounter(service.denials) && isBoundedCounter(service.dispatched) && isBoundedCounter(service.failures) && isBoundedCounter(service.grants) && isBoundedCounter(service.received) && isNullableGeneration(service.generation) && [
		"failed",
		"starting",
		"stopping",
		"stopped",
		"ready"
	].includes(String(service.state)) && [
		"failed",
		"passed",
		"pending"
	].includes(String(service.permissionProbe));
}
function isTypedResult(value, requestId, validateValue) {
	if (!isRecord(value) || typeof value.requestId !== "string" || value.requestId !== requestId || !requestIdPattern.test(value.requestId) || typeof value.ok !== "boolean") return false;
	if (value.ok) return hasExactKeys(value, [
		"ok",
		"requestId",
		"value"
	]) && validateValue(value.value);
	return hasExactKeys(value, [
		"ok",
		"requestId",
		"error"
	]) && isNotoError(value.error);
}
var isServiceResult = (value, requestId) => isTypedResult(value, requestId, isServiceOperationReply);
var isDiagnosticsResult = (value, requestId) => isTypedResult(value, requestId, isDiagnosticsReply);
//#endregion
//#region src/shared/file-truth/v1/validate.ts
var requestId$1 = /^[A-Za-z0-9._:-]{1,96}$/;
var hash = /^[a-f0-9]{64}$/;
var stages = /* @__PURE__ */ new Set([
	"before-temp-write",
	"candidate-durable",
	"temp-written",
	"temp-flushed",
	"metadata-applied",
	"precondition-confirmed",
	"replacement-complete",
	"replacement-verified",
	"journal-complete",
	"cleanup"
]);
var sha256Initial = new Uint32Array([
	1779033703,
	3144134277,
	1013904242,
	2773480762,
	1359893119,
	2600822924,
	528734635,
	1541459225
]);
var sha256RoundConstants = new Uint32Array([
	1116352408,
	1899447441,
	3049323471,
	3921009573,
	961987163,
	1508970993,
	2453635748,
	2870763221,
	3624381080,
	310598401,
	607225278,
	1426881987,
	1925078388,
	2162078206,
	2614888103,
	3248222580,
	3835390401,
	4022224774,
	264347078,
	604807628,
	770255983,
	1249150122,
	1555081692,
	1996064986,
	2554220882,
	2821834349,
	2952996808,
	3210313671,
	3336571891,
	3584528711,
	113926993,
	338241895,
	666307205,
	773529912,
	1294757372,
	1396182291,
	1695183700,
	1986661051,
	2177026350,
	2456956037,
	2730485921,
	2820302411,
	3259730800,
	3345764771,
	3516065817,
	3600352804,
	4094571909,
	275423344,
	430227734,
	506948616,
	659060556,
	883997877,
	958139571,
	1322822218,
	1537002063,
	1747873779,
	1955562222,
	2024104815,
	2227730452,
	2361852424,
	2428436474,
	2756734187,
	3204031479,
	3329325298
]);
var rotateRight = (value, bits) => value >>> bits | value << 32 - bits;
function compressSha256Block(state, block, offset, words) {
	for (let index = 0; index < 16; index += 1) {
		const cursor = offset + index * 4;
		words[index] = (block[cursor] << 24 | block[cursor + 1] << 16 | block[cursor + 2] << 8 | block[cursor + 3]) >>> 0;
	}
	for (let index = 16; index < 64; index += 1) {
		const left = words[index - 15];
		const right = words[index - 2];
		const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ left >>> 3;
		const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ right >>> 10;
		words[index] = words[index - 16] + sigma0 + words[index - 7] + sigma1 >>> 0;
	}
	let [a, b, c, d, e, f, g, h] = state;
	for (let index = 0; index < 64; index += 1) {
		const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
		const choice = e & f ^ ~e & g;
		const temporary1 = h + sum1 + choice + sha256RoundConstants[index] + words[index] >>> 0;
		const temporary2 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
		h = g;
		g = f;
		f = e;
		e = d + temporary1 >>> 0;
		d = c;
		c = b;
		b = a;
		a = temporary1 + temporary2 >>> 0;
	}
	state[0] = state[0] + a >>> 0;
	state[1] = state[1] + b >>> 0;
	state[2] = state[2] + c >>> 0;
	state[3] = state[3] + d >>> 0;
	state[4] = state[4] + e >>> 0;
	state[5] = state[5] + f >>> 0;
	state[6] = state[6] + g >>> 0;
	state[7] = state[7] + h >>> 0;
}
function sha256Hex(bytes) {
	const state = sha256Initial.slice();
	const words = /* @__PURE__ */ new Uint32Array(64);
	const fullBlockLength = bytes.byteLength - bytes.byteLength % 64;
	for (let offset = 0; offset < fullBlockLength; offset += 64) compressSha256Block(state, bytes, offset, words);
	const remainder = bytes.byteLength - fullBlockLength;
	const tail = new Uint8Array(remainder < 56 ? 64 : 128);
	tail.set(bytes.subarray(fullBlockLength));
	tail[remainder] = 128;
	const bitLength = bytes.byteLength * 8;
	const tailView = new DataView(tail.buffer);
	tailView.setUint32(tail.byteLength - 8, Math.floor(bitLength / 4294967296), false);
	tailView.setUint32(tail.byteLength - 4, bitLength >>> 0, false);
	for (let offset = 0; offset < tail.byteLength; offset += 64) compressSha256Block(state, tail, offset, words);
	let digest = "";
	for (const value of state) digest += value.toString(16).padStart(8, "0");
	return digest;
}
var record$1 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var exact$1 = (value, keys) => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
function isFileTruthRequestV1(value) {
	return record$1(value) && exact$1(value, ["version", "requestId"]) && value.version === 1 && typeof value.requestId === "string" && requestId$1.test(value.requestId);
}
function isFingerprint(value) {
	return record$1(value) && exact$1(value, [
		"version",
		"object",
		"byteLength",
		"mtimeNanoseconds",
		"contentSha256"
	]) && value.version === 1 && record$1(value.object) && exact$1(value.object, [
		"scheme",
		"opaqueId",
		"basis"
	]) && value.object.scheme === "noto-file-object-v1" && ["inode", "path"].includes(String(value.object.basis)) && typeof value.object.opaqueId === "string" && value.object.opaqueId.length > 0 && value.object.opaqueId.length <= 256 && Number.isSafeInteger(value.byteLength) && Number(value.byteLength) >= 0 && typeof value.mtimeNanoseconds === "string" && /^\d+$/.test(value.mtimeNanoseconds) && typeof value.contentSha256 === "string" && hash.test(value.contentSha256);
}
function sameFingerprint(left, right) {
	return isFingerprint(left) && isFingerprint(right) && JSON.stringify(left) === JSON.stringify(right);
}
function isAcceptedIdentity(value) {
	return record$1(value) && exact$1(value, [
		"version",
		"canonicalPath",
		"fingerprint",
		"posixMode"
	]) && value.version === 1 && typeof value.canonicalPath === "string" && value.canonicalPath.length > 0 && value.canonicalPath.length <= 4096 && isFingerprint(value.fingerprint) && Number.isSafeInteger(value.posixMode) && Number(value.posixMode) >= 0 && Number(value.posixMode) <= 4095;
}
function isSaveToken(value) {
	return record$1(value) && exact$1(value, [
		"version",
		"documentRevisionId",
		"editorRevision",
		"fingerprint"
	]) && value.version === 1 && typeof value.documentRevisionId === "string" && value.documentRevisionId.startsWith("noto-rev-v3:") && Number.isSafeInteger(value.editorRevision) && Number(value.editorRevision) >= 0 && isFingerprint(value.fingerprint);
}
function isCandidate(value) {
	return record$1(value) && value.version === 3 && exact$1(value, [
		"version",
		"saveToken",
		"transaction"
	]) && isSaveToken(value.saveToken) && isTransaction(value.transaction);
}
function isOrigin(value) {
	return record$1(value) && exact$1(value, [
		"blockId",
		"ordinal",
		"kind",
		"semanticKey"
	]) && typeof value.blockId === "string" && value.blockId.startsWith("noto-block-v3:") && Number.isSafeInteger(value.ordinal) && Number(value.ordinal) >= 0 && typeof value.kind === "string" && value.kind.length <= 64 && typeof value.semanticKey === "string" && value.semanticKey.length <= 2e6;
}
function isTransaction(value) {
	if (!record$1(value) || value.version !== 3 || typeof value.documentId !== "string" || !value.documentId.startsWith("noto-doc-v3:") || typeof value.revisionId !== "string" || !value.revisionId.startsWith("noto-rev-v3:")) return false;
	if (value.mode === "blocks") return exact$1(value, [
		"version",
		"mode",
		"documentId",
		"revisionId",
		"units"
	]) && Array.isArray(value.units) && value.units.length <= 1e5 && value.units.every((unit) => record$1(unit) && exact$1(unit, ["origin", "markdown"]) && (unit.origin === null || isOrigin(unit.origin)) && (unit.markdown === null ? unit.origin !== null : typeof unit.markdown === "string" && unit.markdown.length <= 2e6)) && value.units.reduce((total, unit) => total + (record$1(unit) && typeof unit.markdown === "string" ? unit.markdown.length : 0), 0) <= 67108864;
	return value.mode === "source" && exact$1(value, [
		"version",
		"mode",
		"documentId",
		"revisionId",
		"expectedSourceSha256",
		"sourceBytes"
	]) && typeof value.expectedSourceSha256 === "string" && hash.test(value.expectedSourceSha256) && value.sourceBytes instanceof Uint8Array && value.sourceBytes.byteLength <= 67108864;
}
function isFileTruthSaveRequestV1(value) {
	return record$1(value) && exact$1(value, [
		"version",
		"requestId",
		"candidate"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId$1.test(value.requestId) && isCandidate(value.candidate);
}
function isFileTruthSaveCopyRequestV1(value) {
	return record$1(value) && exact$1(value, [
		"version",
		"requestId",
		"candidate",
		"destinationPath"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId$1.test(value.requestId) && isCandidate(value.candidate) && typeof value.destinationPath === "string" && value.destinationPath.length > 0 && value.destinationPath.length <= 4096;
}
function isResult$1(value, expectedRequestId, validateValue) {
	if (!record$1(value) || value.requestId !== expectedRequestId || typeof value.ok !== "boolean") return false;
	if (value.ok) return exact$1(value, [
		"ok",
		"requestId",
		"value"
	]) && validateValue(value.value);
	return exact$1(value, [
		"ok",
		"requestId",
		"error"
	]) && record$1(value.error) && exact$1(value.error, ["code", "message"]) && ["BAD_REQUEST", "FILE_TRUTH_TRANSPORT_FAILED"].includes(String(value.error.code)) && typeof value.error.message === "string" && value.error.message.length > 0 && value.error.message.length <= 2048;
}
var UTF8_BOM = Uint8Array.from([
	239,
	187,
	191
]);
var encoder = new TextEncoder();
/**
* Re-derive the original file bytes from a wire document.
*
* The wire carries BOM-stripped text, so verifying the envelope hash means
* putting the BOM back first. This is what proves the renderer was handed a
* document whose envelope actually describes its text.
*/
function originalBytesOf(text, bom) {
	const body = encoder.encode(text);
	if (bom !== "utf8") return body;
	const output = new Uint8Array(UTF8_BOM.length + body.length);
	output.set(UTF8_BOM, 0);
	output.set(body, UTF8_BOM.length);
	return output;
}
function isNotoDocumentWire(value) {
	if (!record$1(value) || !exact$1(value, [
		"version",
		"documentId",
		"revisionId",
		"envelope",
		"text",
		"origins",
		"spans"
	]) || value.version !== 3 || typeof value.documentId !== "string" || !value.documentId.startsWith("noto-doc-v3:") || typeof value.revisionId !== "string" || !value.revisionId.startsWith("noto-rev-v3:") || typeof value.text !== "string" || value.text.length > 67108864 || !record$1(value.envelope) || !exact$1(value.envelope, [
		"version",
		"byteLength",
		"bom",
		"lineEnding",
		"hasFinalNewline",
		"sourceSha256"
	]) || value.envelope.version !== 3 || !Number.isSafeInteger(value.envelope.byteLength) || !["utf8", "none"].includes(String(value.envelope.bom)) || ![
		"lf",
		"crlf",
		"mixed"
	].includes(String(value.envelope.lineEnding)) || typeof value.envelope.hasFinalNewline !== "boolean" || typeof value.envelope.sourceSha256 !== "string" || !hash.test(value.envelope.sourceSha256) || !Array.isArray(value.origins) || !value.origins.every(isOrigin) || !Array.isArray(value.spans) || value.spans.length !== value.origins.length || !value.spans.every((span) => record$1(span) && exact$1(span, ["start", "end"]) && Number.isSafeInteger(span.start) && Number(span.start) >= 0 && Number.isSafeInteger(span.end) && Number(span.end) >= Number(span.start) && Number(span.end) <= value.text.length)) return false;
	const bytes = originalBytesOf(value.text, String(value.envelope.bom));
	return value.envelope.byteLength === bytes.byteLength && sha256Hex(bytes) === value.envelope.sourceSha256 && value.origins.every((origin, index) => origin.ordinal === index);
}
/**
* The saved outcome must describe the document it claims to have written.
*
* v3 made this check cheap: identity is derived from content, so the envelope
* hash, the output hash and the accepted fingerprint all have to be one value.
*/
function isMatchingSavedState(document, saveToken, outputSha256) {
	if (!isNotoDocumentWire(document) || !isSaveToken(saveToken) || typeof outputSha256 !== "string") return false;
	return document.revisionId === saveToken.documentRevisionId && document.envelope.sourceSha256 === outputSha256 && document.envelope.sourceSha256 === saveToken.fingerprint.contentSha256 && document.envelope.byteLength === saveToken.fingerprint.byteLength;
}
function isMatchingOpenState(document, saveToken, recovery, initialOutcome) {
	if (document.revisionId !== saveToken.documentRevisionId) return false;
	if (recovery !== null && initialOutcome === null) return document.envelope.sourceSha256 === recovery.candidateSha256 && document.envelope.byteLength === recovery.candidateByteLength;
	return document.envelope.sourceSha256 === saveToken.fingerprint.contentSha256 && document.envelope.byteLength === saveToken.fingerprint.byteLength;
}
function isRecovery(value) {
	return value === null || record$1(value) && exact$1(value, [
		"version",
		"schema",
		"attemptId",
		"stage",
		"originalPath",
		"payloadPath",
		"journalPath",
		"tempPath",
		"candidateSha256",
		"candidateByteLength",
		"acceptedFingerprint",
		"posixMode"
	]) && value.version === 1 && value.schema === "noto-file-truth-journal-v2" && typeof value.attemptId === "string" && value.attemptId.length > 0 && value.attemptId.length <= 128 && typeof value.originalPath === "string" && typeof value.payloadPath === "string" && typeof value.journalPath === "string" && (value.tempPath === null || typeof value.tempPath === "string") && stages.has(String(value.stage)) && typeof value.candidateSha256 === "string" && hash.test(value.candidateSha256) && Number.isSafeInteger(value.candidateByteLength) && Number(value.candidateByteLength) >= 0 && isFingerprint(value.acceptedFingerprint) && Number.isSafeInteger(value.posixMode) && Number(value.posixMode) >= 0 && Number(value.posixMode) <= 4095;
}
function isFileTruthSaveOutcomeV1(value) {
	if (!record$1(value) || value.version !== 1 || typeof value.status !== "string" || typeof value.attemptId !== "string" || value.attemptId.length === 0 || value.attemptId.length > 128 || !stages.has(String(value.safeStage)) || typeof value.dirtyPreserved !== "boolean" || typeof value.message !== "string" || value.message.length === 0 || value.message.length > 4096) return false;
	const base = [
		"version",
		"status",
		"attemptId",
		"safeStage",
		"dirtyPreserved",
		"message"
	];
	const residues = (candidate) => Array.isArray(candidate) && candidate.every((item) => typeof item === "string");
	if (value.status === "saved") return exact$1(value, [
		...base,
		"accepted",
		"saveToken",
		"outputSha256",
		"replacedOriginal",
		"document"
	]) && value.dirtyPreserved === false && isAcceptedIdentity(value.accepted) && isSaveToken(value.saveToken) && sameFingerprint(value.accepted.fingerprint, value.saveToken.fingerprint) && typeof value.outputSha256 === "string" && hash.test(value.outputSha256) && value.outputSha256 === value.accepted.fingerprint.contentSha256 && value.replacedOriginal === true && isMatchingSavedState(value.document, value.saveToken, value.outputSha256);
	if (value.status === "copy-saved") return exact$1(value, [
		...base,
		"destinationPath",
		"outputSha256",
		"replacedOriginal"
	]) && value.dirtyPreserved === true && typeof value.destinationPath === "string" && value.destinationPath.length > 0 && typeof value.outputSha256 === "string" && hash.test(value.outputSha256) && value.replacedOriginal === false;
	if (value.status === "external-conflict") return exact$1(value, [
		...base,
		"acceptedFingerprint",
		"currentFingerprint"
	]) && value.dirtyPreserved === true && isFingerprint(value.acceptedFingerprint) && (value.currentFingerprint === null || isFingerprint(value.currentFingerprint));
	if (value.status === "stale-editor-revision") return exact$1(value, [
		...base,
		"acceptedRevisionId",
		"candidateRevisionId"
	]) && value.dirtyPreserved === true && typeof value.acceptedRevisionId === "string" && typeof value.candidateRevisionId === "string";
	if (value.status === "cleanup-failed") return exact$1(value, [
		...base,
		"primary",
		"recovery",
		"recoveryRecordId",
		"residuePaths"
	]) && value.dirtyPreserved === true && residues(value.residuePaths) && isRecovery(value.recovery) && (value.recoveryRecordId === null || typeof value.recoveryRecordId === "string") && isFileTruthSaveOutcomeV1(value.primary) && value.primary.status !== "cleanup-failed";
	return exact$1(value, [
		...base,
		"recovery",
		"recoveryRecordId",
		"residuePaths"
	]) && [
		"serialization-failed",
		"write-failed",
		"flush-failed",
		"replacement-failed",
		"metadata-failed",
		"recovery-needed",
		"recovery-failed"
	].includes(value.status) && value.dirtyPreserved === true && isRecovery(value.recovery) && residues(value.residuePaths) && (value.recoveryRecordId === null || typeof value.recoveryRecordId === "string") && (value.recovery === null ? value.recoveryRecordId === null : value.recoveryRecordId === value.recovery.attemptId);
}
var isFileTruthBootstrapResultV1 = (value, id) => isResult$1(value, id, (candidate) => record$1(candidate) && exact$1(candidate, [
	"version",
	"enabled",
	"platform"
]) && candidate.version === 1 && typeof candidate.enabled === "boolean" && [
	"darwin",
	"win32",
	"linux"
].includes(String(candidate.platform)));
/**
* Exported on its own because the workspace contract carries an open reply too,
* and both entry points must apply exactly the same check.
*/
function isFileTruthOpenReplyV1(candidate) {
	return record$1(candidate) && exact$1(candidate, [
		"version",
		"path",
		"document",
		"saveToken",
		"recovery",
		"initialOutcome"
	]) && candidate.version === 1 && typeof candidate.path === "string" && candidate.path.length > 0 && isNotoDocumentWire(candidate.document) && isSaveToken(candidate.saveToken) && isRecovery(candidate.recovery) && isMatchingOpenState(candidate.document, candidate.saveToken, candidate.recovery, candidate.initialOutcome) && (candidate.initialOutcome === null || isFileTruthSaveOutcomeV1(candidate.initialOutcome) && candidate.initialOutcome.status === "recovery-failed");
}
var isFileTruthOpenResultV1 = (value, id) => isResult$1(value, id, isFileTruthOpenReplyV1);
var isFileTruthSaveResultV1 = (value, id) => isResult$1(value, id, isFileTruthSaveOutcomeV1);
var isFileTruthDiagnosticsResultV1 = (value, id) => isResult$1(value, id, (candidate) => record$1(candidate) && exact$1(candidate, [
	"version",
	"state",
	"watcherGeneration",
	"watcherEvents",
	"lastOutcome"
]) && candidate.version === 1 && [
	"closed",
	"opened",
	"dirty",
	"saved",
	"conflict",
	"recovery-needed",
	"failed"
].includes(String(candidate.state)) && Number.isSafeInteger(candidate.watcherGeneration) && Number(candidate.watcherGeneration) >= 0 && record$1(candidate.watcherEvents) && exact$1(candidate.watcherEvents, ["self", "foreign"]) && Number.isSafeInteger(candidate.watcherEvents.self) && Number(candidate.watcherEvents.self) >= 0 && Number.isSafeInteger(candidate.watcherEvents.foreign) && Number(candidate.watcherEvents.foreign) >= 0 && (candidate.lastOutcome === null || isFileTruthSaveOutcomeV1(candidate.lastOutcome)));
//#endregion
//#region src/shared/workspace/v1/contracts.ts
var WORKSPACE_CHANNELS = {
	openDialog: "noto:v1:workspace:open-dialog",
	openPath: "noto:v1:workspace:open-path",
	saveAsDialog: "noto:v1:workspace:save-as-dialog",
	recent: "noto:v1:workspace:recent",
	documentOpened: "noto:v1:workspace:document-opened",
	documentClosed: "noto:v1:workspace:document-closed",
	tabsChanged: "noto:v1:workspace:tabs-changed",
	activateTab: "noto:v1:workspace:activate-tab",
	closeTab: "noto:v1:workspace:close-tab",
	openFolder: "noto:v1:workspace:open-folder",
	listFolder: "noto:v1:workspace:list-folder",
	folderChanged: "noto:v1:workspace:folder-changed",
	/** The folder open right now, for a renderer that has just subscribed:
	*  a folder named on the command line opens before the page can listen. */
	folder: "noto:v1:workspace:folder",
	menuCommand: "noto:v1:workspace:menu-command",
	/** The whole openable file list for the current folder, sent once per
	*  folder so ranking can happen in the renderer without a round trip. */
	fileIndex: "noto:v1:workspace:file-index",
	recentFolders: "noto:v1:workspace:recent-folders",
	openRecentFolder: "noto:v1:workspace:open-recent-folder",
	reveal: "noto:v1:workspace:reveal",
	openExternal: "noto:v1:workspace:open-external",
	newFile: "noto:v1:workspace:new-file",
	treeMenu: "noto:v1:workspace:tree-menu",
	searchContent: "noto:v1:workspace:search-content"
};
/**
* Commands the application menu raises that the renderer has to carry out,
* because only the renderer knows the editor's current contents.
*/
/**
* Every command the menu can send the renderer.
*
* A value rather than a bare type union, because the preload has to check an
* incoming command against something at runtime and it was checking against a
* hand-copied list. The two drifted: `widen` and `narrow` reached the menu, the
* validator did not know them, and the items fired into a dropped message. One
* list means the type and the check cannot disagree again.
*/
var WORKSPACE_MENU_COMMANDS = [
	"save",
	"save-as",
	"undo",
	"redo",
	"settings",
	"find",
	"find-replace",
	"toggle-source",
	"block-paragraph",
	"block-heading-1",
	"block-heading-2",
	"block-heading-3",
	"block-heading-4",
	"block-heading-5",
	"block-heading-6",
	"block-heading-up",
	"block-heading-down",
	"block-code",
	"block-math",
	"block-quote",
	"block-ordered-list",
	"block-bullet-list",
	"block-task-list",
	"block-rule",
	"mark-underline",
	"mark-highlight",
	"mark-math",
	"table-insert",
	"table-row-above",
	"table-row-below",
	"table-column-before",
	"table-column-after",
	"table-row-delete",
	"table-column-delete",
	"table-delete",
	"move-up",
	"move-down",
	"move-column-left",
	"move-column-right",
	"insert-link",
	"insert-image",
	"new-file",
	"mark-strong",
	"mark-emphasis",
	"mark-code",
	"mark-strike",
	"clear-format",
	"block-alert-note",
	"block-alert-tip",
	"block-alert-important",
	"block-alert-warning",
	"block-alert-caution",
	"toggle-focus-mode",
	"toggle-typewriter",
	"toggle-outline",
	"command-palette",
	"toggle-sidebar",
	"widen",
	"narrow",
	"quick-open",
	"reveal-document",
	"search-content",
	"navigate-back",
	"navigate-forward"
];
//#endregion
//#region src/shared/workspace/v1/validate.ts
/**
* Workspace message validation.
*
* Same discipline as the other contract families: every message crossing the
* process boundary is parsed here, in shared code, so main and renderer cannot
* drift into disagreeing about what a valid message is.
*/
var requestId = /^[A-Za-z0-9._:-]{1,96}$/;
var menuCommands = WORKSPACE_MENU_COMMANDS;
var record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var exact = (value, keys) => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
function isWorkspaceRequestV1(value) {
	return record(value) && exact(value, ["version", "requestId"]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId);
}
function isWorkspaceOpenPathRequestV1(value) {
	return record(value) && exact(value, [
		"version",
		"requestId",
		"path"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId) && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096;
}
/** Activate and close share a shape, so they share a validator. */
function isWorkspaceTabRequestV1(value) {
	return record(value) && exact(value, [
		"version",
		"requestId",
		"path"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId) && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096;
}
function isTab(value) {
	return record(value) && exact(value, [
		"path",
		"name",
		"documentId",
		"active"
	]) && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096 && typeof value.name === "string" && value.name.length <= 512 && typeof value.documentId === "string" && value.documentId.startsWith("noto-doc-v3:") && typeof value.active === "boolean";
}
function isWorkspaceTabsEventV1(value) {
	return record(value) && exact(value, ["version", "tabs"]) && value.version === 1 && Array.isArray(value.tabs) && value.tabs.length <= 64 && value.tabs.every(isTab);
}
function isWorkspaceClosedEventV1(value) {
	return record(value) && exact(value, ["version"]) && value.version === 1;
}
var isWorkspaceTabsResultV1 = (value, id) => isResult(value, id, isWorkspaceTabsEventV1);
function isWorkspaceFolderRequestV1(value) {
	return record(value) && exact(value, [
		"version",
		"requestId",
		"path"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId) && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096;
}
function isEntry(value) {
	return record(value) && exact(value, [
		"name",
		"path",
		"kind"
	]) && typeof value.name === "string" && value.name.length > 0 && value.name.length <= 512 && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096 && (value.kind === "file" || value.kind === "directory");
}
function isFolderReply(value) {
	return record(value) && exact(value, ["version", "entries"]) && value.version === 1 && Array.isArray(value.entries) && value.entries.length <= 4096 && value.entries.every(isEntry);
}
function isWorkspaceFolderEventV1(value) {
	return record(value) && exact(value, [
		"version",
		"root",
		"name",
		"chosen"
	]) && value.version === 1 && (value.root === null || typeof value.root === "string" && value.root.length <= 4096) && (value.name === null || typeof value.name === "string" && value.name.length <= 512) && typeof value.chosen === "boolean";
}
var isWorkspaceFolderResultV1 = (value, id) => isResult(value, id, isWorkspaceFolderEventV1);
var isWorkspaceListResultV1 = (value, id) => isResult(value, id, isFolderReply);
function isRecentFile(value) {
	return record(value) && exact(value, [
		"path",
		"name",
		"openedAt"
	]) && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096 && typeof value.name === "string" && value.name.length <= 512 && Number.isSafeInteger(value.openedAt) && Number(value.openedAt) >= 0;
}
function isResult(value, expectedRequestId, validateValue) {
	if (!record(value) || value.requestId !== expectedRequestId || typeof value.ok !== "boolean") return false;
	if (value.ok) return exact(value, [
		"ok",
		"requestId",
		"value"
	]) && validateValue(value.value);
	return exact(value, [
		"ok",
		"requestId",
		"error"
	]) && record(value.error) && exact(value.error, ["code", "message"]) && ["BAD_REQUEST", "WORKSPACE_FAILED"].includes(String(value.error.code)) && typeof value.error.message === "string" && value.error.message.length > 0 && value.error.message.length <= 2048;
}
function isOpenReply(value) {
	return record(value) && exact(value, ["version", "opened"]) && value.version === 1 && (value.opened === null || isFileTruthOpenReplyV1(value.opened));
}
function isSaveAsReply(value) {
	return record(value) && exact(value, ["version", "path"]) && value.version === 1 && (value.path === null || typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096);
}
function isRecentReply(value) {
	return record(value) && exact(value, ["version", "files"]) && value.version === 1 && Array.isArray(value.files) && value.files.length <= 64 && value.files.every(isRecentFile);
}
var isWorkspaceOpenResultV1 = (value, id) => isResult(value, id, isOpenReply);
var isWorkspaceSaveAsResultV1 = (value, id) => isResult(value, id, isSaveAsReply);
var isWorkspaceRecentResultV1 = (value, id) => isResult(value, id, isRecentReply);
function isWorkspaceDocumentEventV1(value) {
	return record(value) && exact(value, ["version", "opened"]) && value.version === 1 && isFileTruthOpenReplyV1(value.opened);
}
function isWorkspaceMenuEventV1(value) {
	return record(value) && exact(value, ["version", "command"]) && value.version === 1 && menuCommands.includes(value.command);
}
function isIndexEntryV1(value) {
	return record(value) && exact(value, [
		"path",
		"name",
		"relativePath"
	]) && typeof value.path === "string" && value.path.length > 0 && typeof value.name === "string" && typeof value.relativePath === "string";
}
function isWorkspaceIndexReplyV1(value) {
	return record(value) && exact(value, [
		"version",
		"root",
		"entries",
		"truncated"
	]) && value.version === 1 && (value.root === null || typeof value.root === "string") && typeof value.truncated === "boolean" && Array.isArray(value.entries) && value.entries.every(isIndexEntryV1);
}
function isWorkspaceIndexResultV1(value, expectedRequestId) {
	if (!record(value) || value.requestId !== expectedRequestId) return false;
	if (value.ok === true) return isWorkspaceIndexReplyV1(value.value);
	return value.ok === false && record(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}
var revealTargets = ["folder", "document"];
function isWorkspaceRevealRequestV1(value) {
	return record(value) && exact(value, [
		"version",
		"requestId",
		"target"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId) && revealTargets.includes(value.target);
}
/**
* The only schemes a note may send to the operating system.
*
* Everything else, `file:` most of all, is refused. A URL in a note is text
* somebody else may have written, and `shell.openExternal` will launch a
* handler for any scheme the machine knows.
*/
var OPENABLE_SCHEMES = /* @__PURE__ */ new Set([
	"http:",
	"https:",
	"mailto:"
]);
/**
* The URL to open, normalised, or null when it is not one to open.
*
* The normalised form is what the caller must hand on, not the string it was
* given. The parser this checks with and the one the operating system opens
* with do not have to agree, and they do not: `https:/\/\evil.com` parses
* here as `https://evil.com/`, a tab inside a host is dropped, a newline
* inside a scheme is dropped. Checking one string and opening another is the
* whole of that bug class, so only the checked string is ever opened.
*/
function openableExternalUrl(value) {
	if (value.length === 0 || value.length > 2048) return null;
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		return null;
	}
	if (!OPENABLE_SCHEMES.has(parsed.protocol)) return null;
	return parsed.href;
}
function isOpenableExternalUrl(value) {
	return openableExternalUrl(value) !== null;
}
function isWorkspaceOpenExternalRequestV1(value) {
	return record(value) && exact(value, [
		"version",
		"requestId",
		"url"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId) && typeof value.url === "string" && isOpenableExternalUrl(value.url);
}
function isWorkspaceOpenExternalReplyV1(value) {
	return record(value) && exact(value, ["version", "opened"]) && value.version === 1 && typeof value.opened === "boolean";
}
var isWorkspaceOpenExternalResultV1 = (value, id) => isResult(value, id, isWorkspaceOpenExternalReplyV1);
function isWorkspaceNewFileReplyV1(value) {
	return record(value) && exact(value, [
		"version",
		"created",
		"path"
	]) && value.version === 1 && typeof value.created === "boolean" && (value.path === null || typeof value.path === "string" && value.path.length <= 4096);
}
var isWorkspaceNewFileResultV1 = (value, id) => isResult(value, id, isWorkspaceNewFileReplyV1);
function isWorkspaceTreeMenuRequestV1(value) {
	return record(value) && exact(value, [
		"version",
		"requestId",
		"path",
		"kind"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId) && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096 && (value.kind === "file" || value.kind === "directory");
}
function isWorkspaceTreeMenuReplyV1(value) {
	return record(value) && exact(value, ["version", "accepted"]) && value.version === 1 && typeof value.accepted === "boolean";
}
var isWorkspaceTreeMenuResultV1 = (value, id) => isResult(value, id, isWorkspaceTreeMenuReplyV1);
function isWorkspaceRevealReplyV1(value) {
	return record(value) && exact(value, ["version", "revealed"]) && value.version === 1 && typeof value.revealed === "boolean";
}
var isWorkspaceRevealResultV1 = (value, id) => isResult(value, id, isWorkspaceRevealReplyV1);
function isWorkspaceContentRequestV1(value) {
	return record(value) && exact(value, [
		"version",
		"requestId",
		"query"
	]) && value.version === 1 && typeof value.requestId === "string" && requestId.test(value.requestId) && typeof value.query === "string" && value.query.length <= 200;
}
function isContentLineV1(value) {
	return record(value) && exact(value, [
		"line",
		"lineNumber",
		"column"
	]) && typeof value.line === "string" && Number.isSafeInteger(value.lineNumber) && Number.isSafeInteger(value.column);
}
function isContentMatchV1(value) {
	return record(value) && exact(value, [
		"path",
		"name",
		"relativePath",
		"occurrences",
		"lines"
	]) && typeof value.path === "string" && value.path.length > 0 && typeof value.name === "string" && typeof value.relativePath === "string" && Number.isSafeInteger(value.occurrences) && Array.isArray(value.lines) && value.lines.every(isContentLineV1);
}
function isWorkspaceContentReplyV1(value) {
	return record(value) && exact(value, [
		"version",
		"matches",
		"scanned",
		"truncated",
		"timedOut"
	]) && value.version === 1 && Number.isSafeInteger(value.scanned) && typeof value.truncated === "boolean" && typeof value.timedOut === "boolean" && Array.isArray(value.matches) && value.matches.every(isContentMatchV1);
}
var isWorkspaceContentResultV1 = (value, id) => isResult(value, id, isWorkspaceContentReplyV1);
//#endregion
//#region src/preload/preload.ts
function rejected(requestId, message) {
	return {
		ok: false,
		requestId,
		error: {
			code: "BAD_REQUEST",
			message
		}
	};
}
async function invoke(channel, request, requestId, validate) {
	const value = await electron.ipcRenderer.invoke(channel, request);
	if (!validate(value, requestId)) return rejected(requestId, "Main returned an invalid protocol response");
	return value;
}
async function invokePlugin(request) {
	if (!isPluginLifecycleRequest(request)) return rejected("invalid", "Invalid plugin lifecycle request");
	const value = await electron.ipcRenderer.invoke(IPC_CHANNELS.pluginLifecycle, request);
	return isPluginLifecycleResult(value, request.requestId, request.action) ? value : rejected(request.requestId, "Main returned an invalid plugin lifecycle response");
}
var lifecycleRequest = (action, request) => ({
	...request,
	action
});
var pluginsApi = Object.freeze({
	getSnapshots: (request) => invokePlugin(lifecycleRequest("get-snapshots", request)),
	enable: (request) => invokePlugin(lifecycleRequest("enable", request)),
	disable: (request) => invokePlugin(lifecycleRequest("disable", request)),
	triggerStartup: (request) => invokePlugin(lifecycleRequest("trigger-startup", request)),
	triggerEvent: (request) => invokePlugin(lifecycleRequest("trigger-event", request)),
	triggerHotkey: (request) => invokePlugin(lifecycleRequest("trigger-hotkey", request)),
	executeCommand: (request) => invokePlugin(lifecycleRequest("execute-command", request)),
	setSetting: (request) => invokePlugin(lifecycleRequest("set-setting", request)),
	replaceGeneration: (request) => invokePlugin(lifecycleRequest("replace-generation", request)),
	rendererDisposed: (request) => invokePlugin(lifecycleRequest("renderer-disposed", request)),
	onSnapshots: (listener) => {
		const receive = (_event, value) => {
			if (isPluginSnapshotEvent(value)) listener(value);
		};
		electron.ipcRenderer.on(IPC_CHANNELS.pluginSnapshots, receive);
		return () => {
			electron.ipcRenderer.removeListener(IPC_CHANNELS.pluginSnapshots, receive);
		};
	},
	onRendererRequest: (listener) => {
		const receive = (_event, value) => {
			if (isRendererTransportRequest(value)) listener(value);
		};
		electron.ipcRenderer.on(IPC_CHANNELS.pluginRendererRequest, receive);
		return () => {
			electron.ipcRenderer.removeListener(IPC_CHANNELS.pluginRendererRequest, receive);
		};
	},
	acknowledgeRenderer: (ack) => {
		if (!isRendererTransportAck(ack)) return;
		electron.ipcRenderer.send(IPC_CHANNELS.pluginRendererAck, ack);
	},
	rendererReady: (message) => {
		if (!isRendererReadyMessage(message)) return;
		electron.ipcRenderer.send(IPC_CHANNELS.pluginRendererReady, message);
	}
});
var api = Object.freeze({
	requestService: (request) => isServiceRequest(request) ? invoke(IPC_CHANNELS.service, request, request.requestId, isServiceResult) : Promise.resolve(rejected("invalid", "Invalid service request")),
	diagnostics: (request) => isDiagnosticsRequest(request) ? invoke(IPC_CHANNELS.diagnostics, request, request.requestId, isDiagnosticsResult) : Promise.resolve(rejected("invalid", "Invalid diagnostics request")),
	plugins: pluginsApi
});
electron.contextBridge.exposeInMainWorld("notoDesktop", api);
function rejectedFileTruth(requestId, message) {
	return {
		ok: false,
		requestId,
		error: {
			code: "BAD_REQUEST",
			message
		}
	};
}
async function invokeFileTruth(channel, request, requestId, validate) {
	const value = await electron.ipcRenderer.invoke(channel, request);
	return validate(value, requestId) ? value : rejectedFileTruth(requestId, "Main returned an invalid file-truth v1 response");
}
var fileTruthApi = Object.freeze({
	bootstrap: (request) => isFileTruthRequestV1(request) ? invokeFileTruth(FILE_TRUTH_CHANNELS.bootstrap, request, request.requestId, isFileTruthBootstrapResultV1) : Promise.resolve(rejectedFileTruth("invalid", "Invalid file-truth bootstrap request")),
	open: (request) => isFileTruthRequestV1(request) ? invokeFileTruth(FILE_TRUTH_CHANNELS.open, request, request.requestId, isFileTruthOpenResultV1) : Promise.resolve(rejectedFileTruth("invalid", "Invalid file-truth open request")),
	save: (request) => isFileTruthSaveRequestV1(request) ? invokeFileTruth(FILE_TRUTH_CHANNELS.save, request, request.requestId, isFileTruthSaveResultV1) : Promise.resolve(rejectedFileTruth("invalid", "Invalid file-truth save request")),
	saveCopy: (request) => isFileTruthSaveCopyRequestV1(request) ? invokeFileTruth(FILE_TRUTH_CHANNELS.saveCopy, request, request.requestId, isFileTruthSaveResultV1) : Promise.resolve(rejectedFileTruth("invalid", "Invalid file-truth save-copy request")),
	recover: (request) => isFileTruthRequestV1(request) ? invokeFileTruth(FILE_TRUTH_CHANNELS.recover, request, request.requestId, isFileTruthSaveResultV1) : Promise.resolve(rejectedFileTruth("invalid", "Invalid file-truth recovery request")),
	diagnostics: (request) => isFileTruthRequestV1(request) ? invokeFileTruth(FILE_TRUTH_CHANNELS.diagnostics, request, request.requestId, isFileTruthDiagnosticsResultV1) : Promise.resolve(rejectedFileTruth("invalid", "Invalid file-truth diagnostics request"))
});
electron.contextBridge.exposeInMainWorld("notoFileTruth", fileTruthApi);
function rejectedWorkspace(requestId, message) {
	return {
		ok: false,
		requestId,
		error: {
			code: "BAD_REQUEST",
			message
		}
	};
}
async function invokeWorkspace(channel, request, requestId, validate) {
	const value = await electron.ipcRenderer.invoke(channel, request);
	return validate(value, requestId) ? value : rejectedWorkspace(requestId, "Main returned an invalid workspace response");
}
/**
* Push channels validate before invoking the listener, so a malformed message
* from a compromised main process cannot reach renderer state.
*/
function subscribe(channel, guard, listener) {
	const handler = (_event, value) => {
		if (guard(value)) listener(value);
	};
	electron.ipcRenderer.on(channel, handler);
	return () => {
		electron.ipcRenderer.removeListener(channel, handler);
	};
}
function rejectedSettings(requestId, message) {
	return {
		ok: false,
		requestId,
		error: {
			code: "BAD_REQUEST",
			message
		}
	};
}
async function invokeSettings(channel, request, requestId) {
	const value = await electron.ipcRenderer.invoke(channel, request);
	return isSettingsResultV1(value, requestId) ? value : rejectedSettings(requestId, "Main returned an invalid settings response");
}
var workspaceApi = Object.freeze({
	openDialog: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.openDialog, request, request.requestId, isWorkspaceOpenResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace open request")),
	openPath: (request) => isWorkspaceOpenPathRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.openPath, request, request.requestId, isWorkspaceOpenResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace open-path request")),
	saveAsDialog: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.saveAsDialog, request, request.requestId, isWorkspaceSaveAsResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace save-as request")),
	recent: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.recent, request, request.requestId, isWorkspaceRecentResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace recent request")),
	activateTab: (request) => isWorkspaceTabRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.activateTab, request, request.requestId, isWorkspaceOpenResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace activate-tab request")),
	closeTab: (request) => isWorkspaceTabRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.closeTab, request, request.requestId, isWorkspaceTabsResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace close-tab request")),
	openFolder: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.openFolder, request, request.requestId, isWorkspaceFolderResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace open-folder request")),
	listFolder: (request) => isWorkspaceFolderRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.listFolder, request, request.requestId, isWorkspaceListResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid workspace list-folder request")),
	onFolderChanged: (listener) => subscribe(WORKSPACE_CHANNELS.folderChanged, isWorkspaceFolderEventV1, listener),
	onDocumentOpened: (listener) => subscribe(WORKSPACE_CHANNELS.documentOpened, isWorkspaceDocumentEventV1, listener),
	onDocumentClosed: (listener) => subscribe(WORKSPACE_CHANNELS.documentClosed, isWorkspaceClosedEventV1, listener),
	onTabsChanged: (listener) => subscribe(WORKSPACE_CHANNELS.tabsChanged, isWorkspaceTabsEventV1, listener),
	recentFolders: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.recentFolders, request, request.requestId, isWorkspaceRecentResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid recent folders request")),
	openRecentFolder: (request) => isWorkspaceOpenPathRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.openRecentFolder, request, request.requestId, isWorkspaceFolderResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid open recent folder request")),
	folder: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.folder, request, request.requestId, isWorkspaceFolderResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid folder request")),
	searchContent: (request) => isWorkspaceContentRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.searchContent, request, request.requestId, isWorkspaceContentResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid content search request")),
	reveal: (request) => isWorkspaceRevealRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.reveal, request, request.requestId, isWorkspaceRevealResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid reveal request")),
	openExternal: (request) => isWorkspaceOpenExternalRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.openExternal, request, request.requestId, isWorkspaceOpenExternalResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid external link request")),
	newFile: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.newFile, request, request.requestId, isWorkspaceNewFileResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid new file request")),
	treeMenu: (request) => isWorkspaceTreeMenuRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.treeMenu, request, request.requestId, isWorkspaceTreeMenuResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid tree menu request")),
	fileIndex: (request) => isWorkspaceRequestV1(request) ? invokeWorkspace(WORKSPACE_CHANNELS.fileIndex, request, request.requestId, isWorkspaceIndexResultV1) : Promise.resolve(rejectedWorkspace("invalid", "Invalid file index request")),
	onMenuCommand: (listener) => subscribe(WORKSPACE_CHANNELS.menuCommand, isWorkspaceMenuEventV1, listener)
});
var settingsApi = Object.freeze({
	read: (request) => isSettingsRequestV1(request) ? invokeSettings(SETTINGS_CHANNELS.read, request, request.requestId) : Promise.resolve(rejectedSettings("invalid", "Invalid settings read request")),
	write: (request) => isSettingsWriteRequestV1(request) ? invokeSettings(SETTINGS_CHANNELS.write, request, request.requestId) : Promise.resolve(rejectedSettings("invalid", "Invalid settings write request")),
	readThemeCss: async (request) => {
		if (!isSettingsRequestV1(request)) return {
			ok: false,
			requestId: "invalid",
			error: {
				code: "BAD_REQUEST",
				message: "Invalid theme stylesheet request"
			}
		};
		const value = await electron.ipcRenderer.invoke(SETTINGS_CHANNELS.themeCss, request);
		return isThemeCssResultV1(value, request.requestId) ? value : {
			ok: false,
			requestId: request.requestId,
			error: {
				code: "BAD_REQUEST",
				message: "Main returned an invalid theme stylesheet response"
			}
		};
	},
	onChanged: (listener) => subscribe(SETTINGS_CHANNELS.changed, isSettingsReplyV1, listener)
});
/**
* Pictures.
*
* The bytes go across as a Uint8Array and structured clone copies them, so the
* renderer's buffer is not shared with main and nothing on this side can change
* what main is about to write.
*/
function rejectedAsset(requestId, message) {
	return {
		ok: false,
		requestId,
		error: {
			code: "BAD_REQUEST",
			message
		}
	};
}
async function invokeAsset(channel, request, requestId) {
	const value = await electron.ipcRenderer.invoke(channel, request);
	return isAssetResultV1(value, requestId) ? value : rejectedAsset(requestId, "Main returned an invalid asset response");
}
var assetsApi = Object.freeze({
	write: (request) => isAssetWriteRequestV1(request) ? invokeAsset(ASSET_CHANNELS.write, request, request.requestId) : Promise.resolve(rejectedAsset("invalid", "Invalid image write request")),
	pick: (request) => isAssetRequestV1(request) ? invokeAsset(ASSET_CHANNELS.pick, request, request.requestId) : Promise.resolve(rejectedAsset("invalid", "Invalid image pick request"))
});
electron.contextBridge.exposeInMainWorld("notoWorkspace", workspaceApi);
electron.contextBridge.exposeInMainWorld("notoSettings", settingsApi);
electron.contextBridge.exposeInMainWorld("notoAssets", assetsApi);
/**
* The user's home directory, used only to shorten a displayed path to a leading
* tilde in the status bar.
*
* It is a string the window already effectively knows from any file it has
* open, so showing it reveals nothing, and it never reaches the document. The
* platform itself is not exposed here: bootstrap already reports it, validated,
* and one source for it is enough.
*/
electron.contextBridge.exposeInMainWorld("notoPlatform", Object.freeze({ home: process.env.HOME ?? process.env.USERPROFILE ?? "" }));
//#endregion

//# sourceMappingURL=preload.js.map