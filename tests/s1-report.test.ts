import assert from "node:assert/strict";
import { test } from "node:test";
import { fakePi, makeKeyDeps } from "./helpers.ts";
import { createExtension, type Snapshot } from "../extensions/glm-usage.ts";

const CN = "zai-coding-cn";
const identityTheme = { fg: (_r: string, t: string) => t };
const RESET = 1_787_784_543_214;
const HOUR = 3_600_000;
const settle = () => new Promise((r) => setTimeout(r, 15));

const snapOf = (pct3: number): Snapshot => ({
	level: "max",
	limits: [{ unit: 3, type: "TOKENS_LIMIT", percentage: pct3, nextResetTime: RESET }],
});

interface Log {
	status: Array<{ key: string; text: string }>;
	notifications: Array<{ message: string; level: string }>;
	customCalls: Array<unknown>;
}

function freshCtx(mode: "tui" | "rpc" = "tui") {
	const log: Log = { status: [], notifications: [], customCalls: [] };
	return {
		log,
		ctx: {
			mode,
			ui: {
				setStatus: (key: string, text: string) => {
					log.status.push({ key, text });
				},
				notify: (message: string, level: string) => {
					log.notifications.push({ message, level });
				},
				theme: identityTheme,
				custom: async (factory: unknown) => {
					log.customCalls.push(factory);
					return undefined;
				},
			},
			sessionManager: { getEntries: () => [] as unknown[] },
		},
	};
}

function harness(opts: { queue?: Array<{ status: "ok"; snapshot: Snapshot }>; detail?: { models: unknown[] | null; tools: unknown[] | null }; env?: Record<string, string | undefined>; tty?: boolean } = {}) {
	const pi = fakePi();
	let now = Date.UTC(2026, 7, 27, 4, 0, 0);
	const calls: number[] = [];
	const detailCalls: string[] = [];
	const queue = opts.queue ?? [{ status: "ok", snapshot: snapOf(34) }];
	let cursor = 0;
	const detail = opts.detail ?? { models: null, tools: null };
	const install = createExtension({
		keyDepsFor: (provider: string) => makeKeyDeps({ env: provider === CN ? { ZAI_CODING_CN_API_KEY: "k" } : { ZAI_API_KEY: "k" } }),
		quotaClientFor: () => ({
			fetchQuota: () => {
				calls.push(now);
				const next = queue[Math.min(cursor, queue.length - 1)];
				cursor += 1;
				return Promise.resolve(next);
			},
			fetchDetail: (kind: string) => {
				detailCalls.push(kind);
				const value = kind === "model-usage" ? detail.models : detail.tools;
				return Promise.resolve(value === null ? null : { items: value });
			},
			resetBreaker: () => {},
		}),
		nowFn: () => now,
		tty: opts.tty ?? true,
	});
	install(pi as never);
	return { pi, calls, detailCalls, tick: (ms: number) => { now += ms; } };
}

test("command registered with description; forces refresh bypassing throttle", async () => {
	const h = harness();
	const { ctx, log } = freshCtx();
	await h.pi.runCommand("glm-usage", "", ctx);
	await settle();
	assert.equal(log.customCalls.length, 1, "overlay opened");
	assert.equal(h.calls.length, 1, "forced fetch");
	// Immediately again — throttle must not block a forced command fetch.
	const second = freshCtx();
	await h.pi.runCommand("glm-usage", "", second.ctx);
	await settle();
	assert.equal(h.calls.length, 2, "command bypasses throttle");
});

test("command works when the active model is not a GLM provider (key resolves)", async () => {
	const h = harness();
	const { ctx } = freshCtx();
	await h.pi.emit("model_select", { model: { provider: "anthropic", id: "sonnet" }, previousModel: undefined, source: "set" }, { ui: { setStatus: () => {}, notify: () => {}, theme: identityTheme } });
	const { ctx: cmdCtx, log } = freshCtx();
	await h.pi.runCommand("glm-usage", "", cmdCtx);
	await settle();
	assert.equal(log.customCalls.length, 1);
	assert.equal(h.calls.length, 1, "fetched for the resolvable provider");
	assert.ok(h.detailCalls.includes("model-usage"), "detail attempted");
});

test("no key anywhere: error notify, no overlay", async () => {
	const pi = fakePi();
	const install = createExtension({
		keyDepsFor: () => makeKeyDeps({ env: {} }),
		quotaClientFor: () => ({ fetchQuota: () => Promise.resolve({ status: "error", message: "unreachable" }), fetchDetail: () => Promise.resolve(null), resetBreaker: () => {} }),
		nowFn: () => 0,
		tty: true,
	});
	install(pi as never);
	const { ctx, log } = freshCtx();
	await pi.runCommand("glm-usage", "", ctx);
	await settle();
	assert.equal(log.customCalls.length, 0);
	assert.ok(log.notifications.some((n) => n.level === "error" && /no API key/.test(n.message)));
});

test("detail endpoints degrade to quota-only with a note", async () => {
	const h = harness({ detail: { models: null, tools: null } });
	const { ctx } = freshCtx();
	await h.pi.runCommand("glm-usage", "", ctx);
	await settle();
	assert.deepEqual(h.detailCalls.sort(), ["model-usage", "tool-usage"]);
});

test("--json in non-tui mode prints JSON to the console", async () => {
	const h = harness();
	const origLog = console.log;
	const printed: string[] = [];
	console.log = (...a: unknown[]) => {
		printed.push(a.map(String).join(" "));
	};
	try {
		const { ctx } = freshCtx("rpc");
		await h.pi.runCommand("glm-usage", "--json", ctx);
		await settle();
	} finally {
		console.log = origLog;
	}
	assert.equal(printed.length, 1);
	assert.doesNotThrow(() => JSON.parse(printed[0]));
	const parsed = JSON.parse(printed[0]) as { quota?: unknown; detail?: unknown };
	assert.ok(parsed.quota && parsed.detail, "merged payload");
});

test("overlay content includes quota and closes on Enter/Esc", async () => {
	const h = harness();
	let component: { handleInput: (data: string) => void } | null = null;
	const { ctx } = freshCtx();
	(ctx as { ui: { custom: unknown } }).ui.custom = async (
		factory: (tui: unknown, theme: unknown, kb: unknown, done: (v: unknown) => void) => unknown,
	) => {
		const comp = factory({}, identityTheme, {}, () => {});
		component = comp as { handleInput: (data: string) => void };
		return undefined;
	};
	await h.pi.runCommand("glm-usage", "", ctx);
	await settle();
	assert.ok(component, "component returned from factory");
	// Enter should invoke done without throwing.
	assert.doesNotThrow(() => component?.handleInput("\r"));
});
