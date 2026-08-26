import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportText, formatDetailItem } from "../extensions/glm-usage.ts";

const NOW = Date.UTC(2026, 7, 27, 4, 0, 0); // 2026-08-27 04:00Z
const HOUR = 3_600_000;

const snapshot = {
	level: "max",
	limits: [
		{ unit: 3, type: "TOKENS_LIMIT", percentage: 34, nextResetTime: NOW + 2 * HOUR },
		{ unit: 6, type: "TOKENS_LIMIT", percentage: 2, nextResetTime: NOW + 48 * HOUR },
		{ unit: 5, type: "TIME_LIMIT", percentage: 1, nextResetTime: NOW + 240 * HOUR },
	],
};

test("report: header with plan level, all segments, local reset rendering", () => {
	const text = buildReportText(snapshot, { models: null, tools: null }, { now: NOW });
	assert.match(text, /GLM Coding Plan — max/);
	assert.match(text, /5h window\s+34% used/);
	assert.match(text, /Weekly\s+2% used/);
	assert.match(text, /MCP\s+1% used/);
	assert.match(text, /resets in 2h 0m/);
});

test("report: null percentage renders unknown", () => {
	const text = buildReportText({ level: "lite", limits: [{ unit: 3, type: "TOKENS_LIMIT", percentage: null, nextResetTime: undefined }] }, { models: null, tools: null }, { now: NOW });
	assert.match(text, /5h window\s+unknown%/);
});

test("report: detail sections render generic items; absent detail renders the degrade note", () => {
	const withDetail = buildReportText(
		snapshot,
		{ models: [{ modelCode: "glm-4.7", usage: 1234567 }], tools: [{ tool: "pi", usage: 42 }] },
		{ now: NOW },
	);
	assert.match(withDetail, /Model usage \(last 24h/);
	assert.match(withDetail, /glm-4\.7\s+1234567/);
	assert.match(withDetail, /Tool usage/);
	const degraded = buildReportText(snapshot, { models: null, tools: null }, { now: NOW });
	assert.match(degraded, /Detail endpoints unavailable/);
	assert.doesNotMatch(degraded, /Model usage/);
});

test("formatDetailItem: known keys first, unknown shapes JSON-compact", () => {
	assert.equal(formatDetailItem({ modelName: "glm-4.7", totalTokens: 12 }), "glm-4.7  12");
	assert.match(formatDetailItem({ weird: true }), /^\{.+\}$/);
});
