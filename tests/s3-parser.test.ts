import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuotaResponse } from "../extensions/glm-usage.ts";

const body = (limits: unknown[], level = "max") => ({ code: 200, data: { limits, level } });
const lim = (over: Record<string, unknown>) => ({ type: "TOKENS_LIMIT", unit: 3, percentage: 6, nextResetTime: 1787784543214, ...over });

test("parses all three known units and the level", () => {
	const snap = parseQuotaResponse(body([lim({}), lim({ type: "TOKENS_LIMIT", unit: 6, percentage: 1 }), lim({ type: "TIME_LIMIT", unit: 5, percentage: 1 })]))!;
	assert.equal(snap.level, "max");
	assert.deepEqual(
		snap.limits.map((l) => l.unit),
		[3, 6, 5],
	);
	assert.equal(snap.limits[0].percentage, 6);
	assert.equal(snap.limits[0].nextResetTime, 1787784543214);
});

test("missing unit 6 yields a snapshot without it", () => {
	const snap = parseQuotaResponse(body([lim({}), lim({ type: "TIME_LIMIT", unit: 5, percentage: 1 })]))!;
	assert.ok(!snap.limits.some((l) => l.unit === 6));
});

test("unknown unit 42 is carried generically, not dropped", () => {
	const snap = parseQuotaResponse(body([lim({}), lim({ unit: 42, percentage: 3 })]))!;
	const unknown = snap.limits.find((l) => l.unit === 42);
	assert.ok(unknown);
	assert.equal(unknown.percentage, 3);
});

test("percentage range guard: 101 and fractional and non-numeric become null", () => {
	const snap = parseQuotaResponse(body([lim({ percentage: 101 }), lim({ unit: 6, percentage: 0.16 }), lim({ unit: 5, percentage: "x" })]))!;
	assert.deepEqual(snap.limits.map((l) => l.percentage), [null, null, null]);
});

test("percentage boundary values 0 and 100 are kept", () => {
	const snap = parseQuotaResponse(body([lim({ percentage: 0 }), lim({ unit: 6, percentage: 100 })]))!;
	assert.deepEqual(snap.limits.map((l) => l.percentage), [0, 100]);
});

test("missing nextResetTime is undefined, negative or non-numeric becomes undefined", () => {
	const snap = parseQuotaResponse(body([lim({ nextResetTime: undefined }), lim({ unit: 6, nextResetTime: -5 }), lim({ unit: 5, nextResetTime: "soon" })]))!;
	assert.deepEqual(snap.limits.map((l) => l.nextResetTime), [undefined, undefined, undefined]);
});

test("duplicate unit does not overwrite the first entry", () => {
	const snap = parseQuotaResponse(body([lim({ percentage: 6 }), lim({ percentage: 99 })]))!;
	assert.equal(snap.limits.filter((l) => l.unit === 3).length, 1);
	assert.equal(snap.limits[0].percentage, 6);
});

test("wrong envelope: non-200 code, missing limits array, wrong shape → null", () => {
	assert.equal(parseQuotaResponse({ code: 401, data: { limits: [] } }), null);
	assert.equal(parseQuotaResponse({ code: 200, data: {} }), null);
	assert.equal(parseQuotaResponse({ code: 200, data: { limits: "no" } }), null);
	assert.equal(parseQuotaResponse(null), null);
});
