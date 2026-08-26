import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReset, formatShanghaiTimestamp, renderFooter, shanghaiWindow } from "../extensions/glm-usage.ts";

const snap = (limits: Array<[number, number | null, number?]>) => ({
	level: "max",
	limits: limits.map(([unit, percentage, nextResetTime]) => ({
		unit,
		type: unit === 5 ? "TIME_LIMIT" : "TOKENS_LIMIT",
		percentage,
		nextResetTime,
	})),
});

const NOW = Date.UTC(2026, 7, 27, 4, 0, 0); // 2026-08-27 04:00Z
const HOUR = 3_600_000;

const identityTheme = { fg: (_r: string, t: string) => t } as const;
const markerTheme = { fg: (role: string, text: string) => `${role}(${text})` };

test("footer: all units present → 5h then W, M omitted (two-segment cap)", () => {
	const text = renderFooter(snap([[3, 34, NOW + 2 * HOUR], [6, 12, NOW + 48 * HOUR], [5, 1]]), { now: NOW, theme: identityTheme });
	assert.equal(text, "GLM 5h ███░░░░░ 34%↻2h 0m·W █░░░░░░░ 12%");
});

test("footer: no weekly unit → MCP takes the second slot", () => {
	const text = renderFooter(snap([[3, 6, NOW + HOUR], [5, 12]]), { now: NOW, theme: identityTheme });
	assert.equal(text, "GLM 5h ░░░░░░░░ 6%↻1h 0m·M █░░░░░░░ 12%");
});

test("footer: reset suffix only on the nearest-resetting displayed segment", () => {
	// W resets sooner than 5h here → ↻ lands on W
	const text = renderFooter(snap([[3, 34, NOW + 6 * HOUR], [6, 12, NOW + 2 * HOUR]]), { now: NOW, theme: identityTheme });
	assert.equal(text, "GLM 5h ███░░░░░ 34%·W █░░░░░░░ 12%↻2h 0m");
});

test("footer: missing reset times → no ↻ anywhere", () => {
	const text = renderFooter(snap([[3, 34], [6, 12]]), { now: NOW, theme: identityTheme });
	assert.equal(text, "GLM 5h ███░░░░░ 34%·W █░░░░░░░ 12%");
});

test("footer: unknown units dropped, known kept", () => {
	const text = renderFooter(snap([[42, 3], [3, 34], [7, 9]]), { now: NOW, theme: identityTheme });
	assert.equal(text, "GLM 5h ███░░░░░ 34%");
});

test("footer: guard-null percentage renders ? and does not color by threshold", () => {
	const text = renderFooter(snap([[3, null], [6, 12]]), { now: NOW, theme: identityTheme });
	assert.equal(text, "GLM 5h ░░░░░░░░ ?%·W █░░░░░░░ 12%");
});

test("footer: stale marker appends ~ to the first percentage", () => {
	const text = renderFooter(snap([[3, 34]]), { now: NOW, theme: identityTheme, stale: true });
	assert.equal(text, "GLM 5h ███░░░░░ 34%~");
});

test("footer: color roles by threshold (<50 success, [50,80) warning, >=80 error)", () => {
	const g = renderFooter(snap([[3, 34]]), { now: NOW, theme: markerTheme });
	const y = renderFooter(snap([[3, 55]]), { now: NOW, theme: markerTheme });
	const r = renderFooter(snap([[3, 95]]), { now: NOW, theme: markerTheme });
	assert.ok(g.includes("success(███)"));
	assert.ok(y.includes("warning(████)"));
	assert.ok(r.includes("error(████████)"));
});

test("formatReset: relative under 24h, weekday+time within 7d, short date beyond", () => {
	assert.equal(formatReset(NOW + 100 * 60 * 1000, NOW), "1h 40m");
	assert.equal(formatReset(NOW + 5 * 60 * 1000, NOW), "5m");
	// 2026-08-29 05:00Z → local weekday label of that instant; deterministic via fixed offset env not assumed:
	const d = new Date(NOW + 2 * 24 * HOUR + HOUR);
	const expectDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
	assert.ok(formatReset(NOW + 2 * 24 * HOUR + HOUR, NOW).startsWith(expectDay), formatReset(NOW + 2 * 24 * HOUR + HOUR, NOW));
	assert.match(formatReset(NOW + 12 * 24 * HOUR, NOW), /^[A-Z][a-z]{2}\d{1,2}$/);
});

test("formatReset: past or invalid → empty string", () => {
	assert.equal(formatReset(NOW - 1000, NOW), "");
	assert.equal(formatReset(0, NOW), "");
});

test("shanghai window: yesterday-same-hour → now, formatted Asia/Shanghai", () => {
	const w = shanghaiWindow(NOW);
	assert.equal(w.endTime, "2026-08-27 12:00:00");
	assert.equal(w.startTime, "2026-08-26 12:00:00");
});

test("shanghai timestamp crosses UTC day boundary correctly", () => {
	// 2026-08-27 16:05Z is 2026-08-28 00:05 Shanghai
	assert.equal(formatShanghaiTimestamp(Date.UTC(2026, 7, 27, 16, 5, 3)), "2026-08-28 00:05:03");
});
