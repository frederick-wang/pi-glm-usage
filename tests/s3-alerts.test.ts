import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAlerts, type AlertState } from "../extensions/glm-usage.ts";

const CN = "zai-coding-cn";
const RESET = 1_787_784_543_214;

const snap = (entries: Array<[number, number | null, number?]>) => ({
	level: "max",
	limits: entries.map(([unit, percentage, nextResetTime]) => ({
		unit,
		type: unit === 5 ? "TIME_LIMIT" : "TOKENS_LIMIT",
		percentage,
		nextResetTime: nextResetTime ?? RESET,
	})),
});

const step = (state: AlertState | null, entries: Array<[number, number | null, number?]>) =>
	evaluateAlerts(state, CN, snap(entries));

test("crossing 79→81 emits the 80% alert once; jitter does not re-emit", () => {
	const s0 = step(null, [[3, 79]]);
	assert.equal(s0.emitted.length, 0);
	const s1 = step(s0.state, [[3, 81]]);
	assert.deepEqual(s1.emitted, [{ unit: 3, tier: 80 }]);
	const s2 = step(s1.state, [[3, 79]]);
	assert.equal(s2.emitted.length, 0);
	const s3 = step(s2.state, [[3, 81]]);
	assert.equal(s3.emitted.length, 0, "no re-emit within the same window");
});

test("first observation already above 95 emits only the 95% tier", () => {
	const s = step(null, [[3, 97]]);
	assert.deepEqual(s.emitted, [{ unit: 3, tier: 95 }]);
});

test("first observation between tiers emits only the 80% tier", () => {
	const s = step(null, [[3, 85]]);
	assert.deepEqual(s.emitted, [{ unit: 3, tier: 80 }]);
});

test("drop of 20+ points re-arms; a subsequent crossing emits again", () => {
	const s1 = step(null, [[3, 81]]);
	assert.equal(s1.emitted.length, 1);
	const s2 = step(s1.state, [[3, 60]]);
	assert.equal(s2.emitted.length, 0, "drop itself stays quiet");
	const s3 = step(s2.state, [[3, 82]]);
	assert.deepEqual(s3.emitted, [{ unit: 3, tier: 80 }], "re-armed by the drop");
});

test("nextResetTime within ±15min is the same window; beyond re-arms", () => {
	const s1 = step(null, [[3, 81, RESET]]);
	assert.equal(s1.emitted.length, 1);
	const sameWindow = step(s1.state, [[3, 81, RESET + 14 * 60_000]]);
	assert.equal(sameWindow.emitted.length, 0, "±15min tolerance keeps the window");
	const newWindow = step(s1.state, [[3, 81, RESET + 16 * 60_000]]);
	assert.equal(newWindow.emitted.length, 1, "a new window re-allows");
	const drift = step(s1.state, [[3, 81, RESET - 15 * 60_000]]);
	assert.equal(drift.emitted.length, 0, "backward drift within tolerance is still same window");
});

test("missing nextResetTime degrades to lastPct-based behavior: no window anchor, drop still re-arms", () => {
	const s1 = step(null, [[3, 81, undefined]]);
	assert.equal(s1.emitted.length, 1);
	const s2 = step(s1.state, [[3, 81, undefined]]);
	assert.equal(s2.emitted.length, 0);
	const s3 = step(s2.state, [[3, 60, undefined]]);
	const s4 = step(s3.state, [[3, 82, undefined]]);
	assert.equal(s4.emitted.length, 1);
});

test("units are tracked independently; null percentage skipped; state keyed per provider", () => {
	const s1 = step(null, [
		[3, 81],
		[6, 96],
		[5, null],
	]);
	assert.deepEqual(s1.emitted, [
		{ unit: 3, tier: 80 },
		{ unit: 6, tier: 95 },
	]);
	const sGlobal = evaluateAlerts(s1.state, "zai", snap([[3, 81]]));
	assert.equal(sGlobal.emitted.length, 1, "other provider has its own state");
});
