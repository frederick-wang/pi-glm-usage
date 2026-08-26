import assert from "node:assert/strict";
import { test } from "node:test";
import { fakePi, makeKeyDeps } from "./helpers.ts";
import { createExtension, STATUS_KEY, type Snapshot } from "../extensions/glm-usage.ts";

const CN = "zai-coding-cn";
const identityTheme = { fg: (_r: string, t: string) => t };
const HOUR = 3_600_000;
const settle = () => new Promise((r) => setTimeout(r, 15));

// session_start payload varies; the extension reads event.model ?? ctx.model.
// This helper supplies ctx.model (the documented shape at startup).
function freshCtxFrom(_h: unknown) {
	const log: { status: Array<{ key: string; text: string | undefined }>; notifications: Array<{ message: string; level: string }> } = { status: [], notifications: [] };
	const ctx = {
		mode: "tui",
		model: { provider: "zai-coding-cn", id: "glm-4.7" },
		ui: {
			setStatus: (key: string, text?: string) => {
				log.status.push({ key, text });
			},
			notify: (message: string, level: string) => {
				log.notifications.push({ message, level });
			},
			theme: identityTheme,
		},
	};
	return { ctx, log };
}

const snapOf = (pct3: number): Snapshot => ({
	level: "max",
	limits: [{ unit: 3, type: "TOKENS_LIMIT", percentage: pct3, nextResetTime: Date.now() + 2 * HOUR }],
});

type QueueItem = { status: "ok"; snapshot: Snapshot } | { status: "error"; message: string };

interface Log {
	status: Array<{ key: string; text: string }>;
	notifications: Array<{ message: string; level: string }>;
}

const freshCtx = () => {
	const log: Log = { status: [], notifications: [] };
	const ctx = {
		mode: "tui",
		ui: {
			setStatus: (key: string, text: string) => {
				log.status.push({ key, text });
			},
			notify: (message: string, level: string) => {
				log.notifications.push({ message, level });
			},
			theme: identityTheme,
		},
	};
	return { ctx, log };
};

function harness(opts: { queue?: QueueItem[]; tty?: boolean } = {}) {
	const pi = fakePi();
	let now = Date.UTC(2026, 7, 27, 4, 0, 0);
	const calls: number[] = [];
	const queue = opts.queue ?? [{ status: "ok", snapshot: snapOf(34) }];
	let cursor = 0;
	const quotaClientFor = () => ({
		fetchQuota: () => {
			calls.push(now);
			const next = queue[Math.min(cursor, queue.length - 1)];
			cursor += 1;
			return Promise.resolve(next);
		},
		fetchDetail: () => Promise.resolve(null),
		resetBreaker: () => {},
	});
	const timers: Array<{ unrefed: boolean }> = [];
	const realIds = new WeakMap<object, ReturnType<typeof setInterval>>();
	const realSetInterval = setInterval;
	const intervalSpy = ((cb: () => void, ms?: number) => {
		const entry = { unrefed: false };
		timers.push(entry);
		const id = realSetInterval(cb, ms);
		const fake = {
			unref: () => {
				entry.unrefed = true;
			},
			ref: () => {},
			hasRef: () => true,
		};
		realIds.set(fake, id);
		return fake;
	}) as unknown as typeof setInterval;
	const clears: unknown[] = [];
	const realClearInterval = clearInterval;
	const install = createExtension({
		env: { PI_GLM_USAGE_LANG: "en" },
		keyDepsFor: () => makeKeyDeps({ env: { ZAI_CODING_CN_API_KEY: "k" } }),
		quotaClientFor,
		nowFn: () => now,
		interactive: opts.tty ?? true,
		setInterval: intervalSpy,
		clearInterval: ((handle: unknown) => {
			clears.push(handle);
			const real = handle !== null && typeof handle === "object" ? realIds.get(handle) : undefined;
			realClearInterval((real ?? handle) as ReturnType<typeof setInterval>);
		}) as typeof clearInterval,
	});
	install(pi as never);
	const select = async (provider: string) => {
		const { ctx, log } = freshCtx();
		await pi.emit("model_select", { model: { provider, id: "glm-4.7" }, previousModel: undefined, source: "set" }, ctx);
		return { log };
	};
	const turnEnd = async () => {
		const { ctx, log } = freshCtx();
		await pi.emit("turn_end", { turnIndex: 0, message: {}, toolResults: [] }, ctx);
		return { log };
	};
	const agentStart = async () => pi.emit("agent_start", {}, freshCtx().ctx);
	const agentEnd = async () => pi.emit("agent_end", {}, freshCtx().ctx);
	const shutdown = async () => pi.emit("session_shutdown", { reason: "quit", targetSessionFile: undefined }, freshCtx().ctx);
	return { pi, select, turnEnd, agentStart, agentEnd, shutdown, calls, timers, clears, tick: (ms: number) => { now += ms; } };
}

test("plain startup with a GLM default model activates via session_start (no model_select)", async () => {
	const h = harness();
	const { ctx, log } = freshCtxFrom(h);
	await h.pi.emit("session_start", { reason: "new" }, ctx);
	await settle();
	assert.equal(h.calls.length, 1, "seeded fetch on startup");
	assert.match(log.status.at(-1)?.text ?? "", /GLM 5h 34%/);
});

test("plain startup with a non-GLM default model stays inactive", async () => {
	const h = harness();
	const { ctx, log } = freshCtxFrom(h);
	await h.pi.emit(
		"session_start",
		{ reason: "new", model: { provider: "anthropic", id: "sonnet" } },
		ctx,
	);
	await settle();
	assert.equal(h.calls.length, 0);
});

test("activation fetches once and renders quota into the footer", async () => {
	const h = harness();
	const { log } = await h.select(CN);
	await settle();
	assert.equal(h.calls.length, 1);
	const last = log.status.at(-1);
	assert.equal(last?.key, STATUS_KEY);
	assert.match(last?.text ?? "", /GLM 5h 34%/);
});

test("throttle: burst of turn_end does not refetch before 180s", async () => {
	const h = harness();
	await h.select(CN);
	await settle();
	for (let i = 0; i < 5; i++) await h.turnEnd();
	assert.equal(h.calls.length, 1, "all inside the window");
	h.tick(181_000);
	await h.turnEnd();
	assert.equal(h.calls.length, 2, "refetch after the window elapses");
});

test("throttle tightens to 60s when usage is above 80%", async () => {
	const h = harness({ queue: [{ status: "ok", snapshot: snapOf(85) }] });
	await h.select(CN);
	await settle();
	h.tick(61_000);
	await h.turnEnd();
	assert.equal(h.calls.length, 2, "high usage shortens the window");
});

test("late response after provider switch is discarded (generation guard)", async () => {
	const pi = fakePi();
	let releaseFetch: ((v: QueueItem) => void) | null = null;
	const install = createExtension({
		env: { PI_GLM_USAGE_LANG: "en" },
		keyDepsFor: () => makeKeyDeps({ env: { ZAI_CODING_CN_API_KEY: "k" } }),
		quotaClientFor: () => ({
			fetchQuota: () =>
				new Promise<QueueItem>((resolve) => {
					releaseFetch = resolve;
				}),
			fetchDetail: () => Promise.resolve(null),
			resetBreaker: () => {},
		}),
		nowFn: () => Date.UTC(2026, 7, 27, 4, 0, 0),
		interactive: true,
	});
	install(pi as never);
	const on = freshCtx();
	await pi.emit("model_select", { model: { provider: CN, id: "glm-4.7" }, previousModel: undefined, source: "set" }, on.ctx);
	const off = freshCtx();
	await pi.emit("model_select", { model: { provider: "anthropic", id: "sonnet" }, previousModel: undefined, source: "set" }, off.ctx);
	assert.equal(off.log.status.at(-1)?.text, undefined, "cleared on switch");
	(releaseFetch as ((v: QueueItem) => void) | null)?.({ status: "ok", snapshot: snapOf(34) });
	await settle();
	assert.equal(on.log.status.filter((e) => /5h 34%/.test(e.text)).length, 0, "late response never renders");
	assert.equal(off.log.status.filter((e) => /GLM/.test(e.text)).length, 0, "cleared footer stays cleared");
});

test("failed refresh keeps the last snapshot with a stale marker", async () => {
	const h = harness({ queue: [{ status: "ok", snapshot: snapOf(30) }, { status: "error", message: "boom" }] });
	const first = await h.select(CN);
	await settle();
	assert.match(first.log.status.at(-1)?.text ?? "", /5h 30%/);
	assert.doesNotMatch(first.log.status.at(-1)?.text ?? "", /~/);
	h.tick(181_000);
	const after = await h.turnEnd();
	await settle();
	assert.match(after.log.status.at(-1)?.text ?? "", /30%~/, `stale marker present, got: ${after.log.status.at(-1)?.text}`);
});

test("headless (non-TTY): no fetches, no timers", async () => {
	const h = harness({ tty: false });
	await h.select(CN);
	await settle();
	h.tick(181_000);
	await h.turnEnd();
	await h.agentStart();
	assert.equal(h.calls.length, 0);
	assert.equal(h.timers.length, 0);
});

test("agent_start starts an unref'd countdown timer; agent_end and session_shutdown clear it", async () => {
	const h = harness();
	await h.select(CN);
	await settle();
	await h.agentStart();
	assert.equal(h.timers.length, 1, "timer started");
	assert.ok(h.timers[0].unrefed, "timer unref'd");
	await h.agentEnd();
	await h.shutdown();
	assert.ok(h.clears.length >= 1, "interval cleared");
});
