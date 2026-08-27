import assert from "node:assert/strict";
import { test } from "node:test";
import { fakePi, makeKeyDeps, stubKb } from "./helpers.ts";
import { createExtension, type Snapshot, visualWidth, wrapLines, windowSlice, clampScrollTop, createOverlayComponent } from "../extensions/glm-usage.ts";

const CN = "zai-coding-cn";
const RESET = 1_787_784_543_214;
const settle = () => new Promise((r) => setTimeout(r, 15));
const snapOf = (pct3: number): Snapshot => ({
	level: "max",
	limits: [{ unit: 3, type: "TOKENS_LIMIT", percentage: pct3, nextResetTime: RESET }],
});

// ---------------------------------------------------------------------------
// Pure helpers — the contract layer that shipped the vertical-stacking bug.
// ---------------------------------------------------------------------------

test("visualWidth: ANSI zero-width, CJK double, emoji double", () => {
	const RED = "\x1b[31m";
	assert.equal(visualWidth(`${RED}abc\x1b[0m`), 3);
	assert.equal(visualWidth("余额"), 4);
	assert.equal(visualWidth("💥"), 2);
});

test("visualWidth: OSC-8 hyperlink is zero-width", () => {
	const link = "\x1b]8;;https://example.com\x1b\\text\x1b]8;;\x1b\\";
	assert.equal(visualWidth(link), 4);
});

test("wrapLines: preserves content, wraps on visual width, ANSI atomic", () => {
	const out = wrapLines(["abcdefghij"], 4);
	assert.deepEqual(out, ["abcd", "efgh", "ij"]);
	assert.equal(out.join(""), "abcdefghij");
	const styled = "\x1b[31mabcdef\x1b[0m";
	const sw = wrapLines([styled], 3);
	assert.equal(sw.length, 2);
	assert.equal(sw.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join(""), "abcdef");
});

test("wrapLines: CJK wraps on double width; wide glyph dropped if it can't fit", () => {
	const out = wrapLines(["余余额额余"], 6);
	assert.deepEqual(out, ["余余额", "额余"]);
	// A 2-col glyph in a 1-col line is dropped rather than overflowing.
	const tiny = wrapLines(["余"], 1);
	assert.deepEqual(tiny, []);
});

test("clampScrollTop / windowSlice: right math", () => {
	assert.equal(clampScrollTop(99, 10, 5), 5);
	assert.equal(clampScrollTop(-3, 10, 5), 0);
	const w = windowSlice(["a", "b", "c", "d", "e", "f"], 99, 4);
	assert.deepEqual(w.lines, ["c", "d", "e", "f"]);
	assert.equal(w.atEnd, true);
});

// ---------------------------------------------------------------------------
// Overlay component — the real contract (render string[], kb-matched keys).
// ---------------------------------------------------------------------------

test("createOverlayComponent: render returns string[], no embedded newlines, box closed", () => {
	const kb = stubKb();
	let done = 0;
	const c = createOverlayComponent({
		header: "GLM 用量报告",
		body: ["GLM Coding Plan — 5h window", "  Weekly  43% used"],
		footer: "press close",
		theme: { fg: (_r: string, t: string) => t },
		kb,
		done: () => { done += 1; },
		rowGen: () => 24,
		lang: "zh",
	});
	const out = c.render(60);
	assert.ok(Array.isArray(out), "render returns array");
	for (const l of out) assert.ok(!l.includes("\n"), "no embedded newlines");
	assert.match(out[0]!, /^╭/);
	assert.match(out.at(-1)!, /^╰/);
	// Every row exactly width columns.
	for (const l of out) assert.equal(visualWidth(l), 60, JSON.stringify(l));
});

test("createOverlayComponent: closes on Enter/Esc/Ctrl+C in legacy + Kitty encodings", () => {
	const kb = stubKb();
	for (const key of ["\r", "\x1b[13u", "\x1b", "\x1b[27u", "\x03", "\x1b[99;5u"]) {
		let done = 0;
		const c = createOverlayComponent({
			header: "T", body: ["a"], footer: "close",
			theme: { fg: (_r: string, t: string) => t },
			kb, done: () => { done += 1; }, rowGen: () => 24, lang: "en",
		});
		c.handleInput(key);
		assert.equal(done, 1, `key ${JSON.stringify(key)}`);
		c.handleInput(key);
		assert.equal(done, 1, "no double resolve");
	}
});

test("createOverlayComponent: overflow shows status and scrolls; footer always visible", () => {
	const kb = stubKb();
	const body = Array.from({ length: 40 }, (_, i) => `row ${i} 数据`);
	const c = createOverlayComponent({
		header: "GLM 用量报告", body, footer: "Esc 关闭",
		theme: { fg: (_r: string, t: string) => t },
		kb, done: () => {}, rowGen: () => 24, lang: "zh",
	});
	const out0 = c.render(60);
	assert.ok(out0.some((l) => /(lines|行) ·/.test(l)), "status line on overflow");
	const bodyWindow = () => c.render(60).filter((l) => /^│.*│$/.test(l) && /\S/.test(l.slice(1, -1)) && !/(lines|行) ·/.test(l) && !/close/.test(l));
	const before = bodyWindow();
	c.handleInput("\x1b[B"); // down
	const after = bodyWindow();
	assert.notDeepEqual(after, before, "scroll moves");
	c.handleInput("\x1b[F"); // end
	assert.ok(c.render(60).some((l) => /close|关闭/.test(l)), "close hint present at end");
});

test("createOverlayComponent: height budget closed at any rows/width", () => {
	const kb = stubKb();
	const body = Array.from({ length: 60 }, (_, i) => `row ${i} 余额 long`);
	for (const rows of [5, 6, 8, 12, 24, 40]) {
		const budget = Math.max(1, Math.floor(rows * 0.8));
		for (const width of [80, 40, 20, 10, 6]) {
			const c = createOverlayComponent({
				header: "GLM 用量报告", body, footer: "Esc 关闭",
				theme: { fg: (_r: string, t: string) => t },
				kb, done: () => {}, rowGen: () => rows, lang: "zh",
			});
			const out = c.render(width);
			assert.ok(out.length <= budget, `rows=${rows} width=${width}: ${out.length} > ${budget}`);
			for (const l of out) assert.ok(visualWidth(l) <= width, `row ${JSON.stringify(l)} > ${width}`);
		}
	}
});

test("createOverlayComponent: exact row width in boxed mode at 60/30/10", () => {
	const kb = stubKb();
	const body = ["GLM Coding Plan — max", "  5h window   43% used"];
	for (const width of [60, 30, 10]) {
		const c = createOverlayComponent({
			header: "GLM 用量报告", body, footer: "Esc 关闭",
			theme: { fg: (_r: string, t: string) => t },
			kb, done: () => {}, rowGen: () => 24, lang: "zh",
		});
		const out = c.render(width);
		if (width >= 8) {
			for (const l of out) assert.equal(visualWidth(l), width, `width ${width}: ${JSON.stringify(l)}`);
		} else {
			for (const l of out) assert.ok(visualWidth(l) <= width);
		}
	}
});

test("createOverlayComponent: every scroll key ID moves the window", () => {
	const kb = stubKb();
	const body = Array.from({ length: 30 }, (_, i) => `row ${i}`);
	const c = createOverlayComponent({
		header: "T", body, footer: "Esc 关闭",
		theme: { fg: (_r: string, t: string) => t },
		kb, done: () => {}, rowGen: () => 24, lang: "zh",
	});
	const win = () => c.render(60).filter((l) => /^│.*│$/.test(l) && /\S/.test(l.slice(1, -1)) && !/(lines|行) ·/.test(l) && !/close|关闭/.test(l));
	const top = win();
	// Down / pageDown / end move from the top.
	for (const key of [["\x1b[B", "down"], ["\x1b[6~", "pageDown"], ["\x1b[F", "end"]]) {
		c.handleInput("\x1b[H");
		c.handleInput(key[0]);
		assert.notDeepEqual(win(), top, `${key[1]} moved the window`);
	}
	// Up returns one row; pageUp backs a page — measure from mid-window.
	c.handleInput("\x1b[H");
	const t2 = win();
	c.handleInput("\x1b[B");
	c.handleInput("\x1b[A");
	assert.deepEqual(win(), t2, "up returns exactly one row");
	c.handleInput("\x1b[6~"); // pageDown from top-ish
	const mid = win();
	c.handleInput("\x1b[5~"); // pageUp back
	assert.notDeepEqual(win(), mid, "pageUp moved back");
	// Home returns to the top from anywhere.
	c.handleInput("\x1b[F");
	c.handleInput("\x1b[H");
	assert.deepEqual(win(), top, "home returns to top");
});

// ---------------------------------------------------------------------------
// Integration — /glm-usage drives the real component through the seam.
// ---------------------------------------------------------------------------

function harness() {
	const pi = fakePi();
	const install = createExtension({
		env: { PI_GLM_USAGE_LANG: "zh" },
		keyDepsFor: (provider: string) => makeKeyDeps({ env: provider === CN ? { ZAI_CODING_CN_API_KEY: "k" } : { ZAI_API_KEY: "k" } }),
		quotaClientFor: () => ({
			fetchQuota: () => Promise.resolve({ status: "ok" as const, snapshot: snapOf(43) }),
			fetchDetail: () => Promise.resolve(null),
			resetBreaker: () => {},
		}),
		nowFn: () => Date.UTC(2026, 7, 27, 4, 0, 0),
		interactive: true,
	});
	install(pi as never);
	return pi;
}

test("integration: /glm-usage renders a bordered string[] overlay with 80% maxHeight", async () => {
	const pi = harness();
	const artifact = { component: null as { render(w: number): string[] } | null, options: null as { overlay?: boolean; overlayOptions?: { maxHeight?: number | string } } | null, doneCalls: 0, rows: 24 };
	const ctx = {
		mode: "tui",
		ui: {
			setStatus: () => {},
			notify: () => {},
			theme: { fg: (_r: string, t: string) => t },
			custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (v: unknown) => void) => unknown, options?: { overlay?: boolean; overlayOptions?: { maxHeight?: number | string } }) => {
				artifact.options = options ?? null;
				artifact.component = factory({ terminal: { rows: 24 } }, { fg: (_r: string, t: string) => t }, stubKb(), () => {}) as { render(w: number): string[] };
				return undefined;
			},
		},
	};
	await pi.runCommand("glm-usage", "", ctx);
	await settle();
	assert.ok(artifact.component, "component captured");
	const out = artifact.component!.render(60);
	assert.ok(Array.isArray(out), "array");
	assert.match(out[0]!, /^╭/, "boxed");
	assert.equal(artifact.options?.overlay, true);
	assert.equal(artifact.options?.overlayOptions?.maxHeight, "80%");
});
