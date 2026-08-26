import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateQuotaRate, quotaRunwayHours, minExhaustionHours } from "../extensions/glm-usage.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 7, 27, 0, 0, 0);
const snap = (t: number, pct: number) => ({ t, percentage: pct });

test("rate: linear climb within one window -> pct per hour", () => {
	const rate = estimateQuotaRate([snap(T0, 20), snap(T0 + H, 30), snap(T0 + 2 * H, 40)]);
	assert.ok(rate);
	assert.ok(Math.abs(rate - 10) < 1e-9, `got ${rate}`);
});

test("rate: gated below 3 snapshots or 1h span", () => {
	assert.equal(estimateQuotaRate([snap(T0, 20), snap(T0 + H, 30)]), null);
	assert.equal(estimateQuotaRate([snap(T0, 20), snap(T0 + 30 * 60_000, 25), snap(T0 + 45 * 60_000, 30)]), null);
});

test("rate: a >=20pt drop (window reset) restarts the window", () => {
	const rate = estimateQuotaRate([snap(T0, 20), snap(T0 + H, 90), snap(T0 + 2 * H, 10), snap(T0 + 3 * H, 20), snap(T0 + 4 * H, 30)]);
	assert.ok(rate);
	assert.ok(Math.abs(rate - 10) < 1e-9, `rate from post-reset window, got ${rate}`);
});

test("rate: flat usage yields null (no climb, nothing to estimate)", () => {
	assert.equal(estimateQuotaRate([snap(T0, 40), snap(T0 + H, 40), snap(T0 + 2 * H, 40)]), null);
});

test("runway: (100 - pct) / rate", () => {
	assert.ok(Math.abs((quotaRunwayHours(30, 10) ?? NaN) - 7) < 1e-9);
	assert.equal(quotaRunwayHours(100, 10), null, "already full");
	assert.equal(quotaRunwayHours(30, 0), null);
});

test("minExhaustion: caps runway at the reset moment; ignores reset when sooner", () => {
	const now = T0;
	const resetIn2h = T0 + 2 * H;
	assert.equal(minExhaustionHours(7, now, resetIn2h), 2, "reset comes first");
	assert.equal(minExhaustionHours(1.5, now, resetIn2h), 1.5, "quota exhausts first");
	assert.equal(minExhaustionHours(7, now, undefined), 7, "no reset time -> rate only");
});

test("snapshot store compacts at 1000 lines to the newest 500", async () => {
	const { createQuotaSnapshotStore } = await import("../extensions/glm-usage.ts");
	let file = "";
	const readFile = (_p: string) => file;
	const appendFile = (_p: string, s: string) => { file += s; };
	const writeFile = (_p: string, s: string) => { file = s; };
	const rename = (_f: string, _t: string) => {};
	const store = createQuotaSnapshotStore("/fake", readFile, appendFile, writeFile, rename);
	for (let i = 0; i < 1001; i++) store.append("zai-coding-cn", 3, { t: i, percentage: (i % 50) + 1 });
	const lines = file.trim().split("\n");
	assert.equal(lines.length, 500, "compacted to KEEP");
	const first = JSON.parse(lines[0]);
	assert.equal(first.t, 501, "kept the newest");
});

test("footer appends ≈ suffix when the rate says quota exhausts before the reset", async () => {
	const { renderFooter } = await import("../extensions/glm-usage.ts");
	const id = { fg: (_r: string, t: string) => t };
	const H = 3_600_000;
	const now = Date.UTC(2026, 7, 27, 0, 0, 0);
	const snaps = [
		{ t: now - 2 * H, percentage: 20 },
		{ t: now - H, percentage: 40 },
		{ t: now, percentage: 60 },
	]; // rate 20/h - runway 2h; reset in 5h -> exhaustion first
	const out = renderFooter(
		{ level: "max", limits: [{ unit: 3, type: "TOKENS_LIMIT", percentage: 60, nextResetTime: now + 5 * H }] },
		{ now, theme: id, snaps5h: snaps },
	);
	assert.match(out, /60% ↻5h 0m ≈2\.0h$/, `got: ${out}`);
	// Reset sooner than exhaustion -> no suffix (the countdown is the truth).
	const out2 = renderFooter(
		{ level: "max", limits: [{ unit: 3, type: "TOKENS_LIMIT", percentage: 60, nextResetTime: now + 1 * H }] },
		{ now, theme: id, snaps5h: snaps },
	);
	assert.doesNotMatch(out2, /≈/, `got: ${out2}`);
});
