import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBar, renderFooter } from "../extensions/glm-usage.ts";

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const HOUR = 3_600_000;
const identityTheme = { fg: (_r: string, t: string) => t };

const snap = (entries: Array<[number, number | null, number?]>) => ({
	level: "max",
	limits: entries.map(([unit, percentage, nextResetTime]) => ({
		unit,
		type: unit === 5 ? "TIME_LIMIT" : "TOKENS_LIMIT",
		percentage,
		nextResetTime,
	})),
});

test("renderBar: 8 cells, filled rounds, empty cells dim", () => {
	assert.equal(renderBar(0, identityTheme), "░░░░░░░░");
	assert.equal(renderBar(100, identityTheme), "████████");
	// 34% → round(2.72) = 3 filled
	assert.equal(renderBar(34, identityTheme), "███░░░░░");
	// 50% → 4 filled exactly
	assert.equal(renderBar(50, identityTheme), "████░░░░");
});

test("renderBar: color follows the threshold roles", () => {
	const marker = { fg: (r: string, t: string) => `${r}[${t}]` };
	assert.equal(renderBar(34, marker), "success[███]dim[░░░░░]");
	assert.equal(renderBar(55, marker), "warning[████]dim[░░░░]");
	assert.equal(renderBar(85, marker), "error[███████]dim[░]");
});

test("renderBar: null percentage renders empty bar in dim", () => {
	const marker = { fg: (r: string, t: string) => `${r}[${t}]` };
	assert.equal(renderBar(null, marker), "dim[]dim[░░░░░░░░]");
});

test("footer: bar precedes the percentage on each segment", () => {
	const text = renderFooter(snap([[3, 34, NOW + 2 * HOUR], [6, 12, NOW + 48 * HOUR]]), { now: NOW, theme: identityTheme });
	// GLM 5h ██…░ 34%↻…·W … 12%
	assert.match(text, /GLM 5h ██{1,7}░{1,7} 34%(↻[^·]*)?·W /);
});

test("footer: stale marker still appends to the percentage", () => {
	const text = renderFooter(snap([[3, 34]]), { now: NOW, theme: identityTheme, stale: true });
	assert.match(text, /34%~$/);
});
