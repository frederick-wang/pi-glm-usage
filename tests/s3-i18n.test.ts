import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportText, msg, resolveLang } from "../extensions/glm-usage.ts";

const NOW = Date.UTC(2026, 7, 27, 4, 0, 0);
const HOUR = 3_600_000;
const snapshot = {
	level: "max",
	limits: [
		{ unit: 3, type: "TOKENS_LIMIT", percentage: 34, nextResetTime: NOW + 2 * HOUR },
		{ unit: 6, type: "TOKENS_LIMIT", percentage: 2, nextResetTime: NOW + 48 * HOUR },
	],
};

test("resolveLang: explicit env wins over locale", () => {
	assert.equal(resolveLang({ PI_GLM_USAGE_LANG: "en" }), "en");
	assert.equal(resolveLang({ PI_GLM_USAGE_LANG: "zh" }), "zh");
	// The locale tier reads the process startup environment and cannot be
	// injected here; the zh report rendering below covers the zh catalog, and
	// the explicit tier is what production wiring must pass through.
});

test("resolveLang: invalid explicit value falls through to locale detection", () => {
	assert.ok(["en", "zh"].includes(resolveLang({ PI_GLM_USAGE_LANG: "fr" })));
	assert.ok(["en", "zh"].includes(resolveLang({})));
});

test("msg: en and zh keys render; missing key falls back to en then key name", () => {
	assert.equal(msg("en", "pressClose"), "Press Enter or Esc to close");
	assert.equal(msg("zh", "pressClose"), "按 Enter 或 Esc 关闭");
	assert.equal(msg("zh", "nonexistent", {}), "nonexistent");
});

test("report renders in zh when lang is zh", () => {
	const zh = buildReportText(snapshot, { models: null, tools: null }, { now: NOW, lang: "zh" });
	assert.match(zh, /5小时窗口\s+34% 已用/);
	assert.match(zh, /周配额\s+2% 已用/);
	assert.match(zh, /2h 0m 后重置/);
	assert.match(zh, /该供应商暂无明细端点/);
});

test("report renders in en when lang is en (locale-independent)", () => {
	const en = buildReportText(snapshot, { models: null, tools: null }, { now: NOW, lang: "en" });
	assert.match(en, /5h window\s+34% used/);
	assert.match(en, /resets in 2h 0m/);
});

test("zh noKey guidance names provider and env var", () => {
	const zh = msg("zh", "noKey", { provider: "zai-coding-cn", key: "zai-coding-cn", envVar: "ZAI_CODING_CN_API_KEY" });
	assert.match(zh, /zai-coding-cn/);
	assert.match(zh, /ZAI_CODING_CN_API_KEY/);
});
