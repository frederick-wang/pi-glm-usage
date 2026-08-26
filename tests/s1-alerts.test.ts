import assert from "node:assert/strict";
import { test } from "node:test";
import { fakePi, makeKeyDeps } from "./helpers.ts";
import { createExtension, type AlertState, type Snapshot } from "../extensions/glm-usage.ts";

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
}

const freshCtx = () => {
	const log: Log = { status: [], notifications: [] };
	return {
		log,
		ctx: {
			ui: {
				setStatus: (key: string, text: string) => {
					log.status.push({ key, text });
				},
				notify: (message: string, level: string) => {
					log.notifications.push({ message, level });
				},
				theme: identityTheme,
			},
			sessionManager: {
				getEntries: () => [] as unknown[],
			},
		},
	};
};

function harness(opts: { queue?: Array<{ status: "ok"; snapshot: Snapshot }>; saved?: AlertState | null } = {}) {
	const pi = fakePi() as ReturnType<typeof fakePi> & Record<string, unknown>;
	const saved: Array<AlertState> = [];
	const appendEntryCalls: Array<unknown> = [];
	(pi as { appendEntry?: unknown }).appendEntry = (type: string, data: unknown) => {
		appendEntryCalls.push({ type, data });
		if (type === "pi-glm-usage-alerts") saved.push(data as AlertState);
	};
	const restored: AlertState | null = opts.saved ?? null;
	const queue = opts.queue ?? [{ status: "ok", snapshot: snapOf(34) }];
	let cursor = 0;
	let now = Date.UTC(2026, 7, 27, 4, 0, 0);
	const install = createExtension({
		keyDepsFor: () => makeKeyDeps({ env: { ZAI_CODING_CN_API_KEY: "k" } }),
		quotaClientFor: () => ({
			fetchQuota: () => {
				const next = queue[Math.min(cursor, queue.length - 1)];
				cursor += 1;
				return Promise.resolve(next);
			},
			fetchDetail: () => Promise.resolve(null),
			resetBreaker: () => {},
		}),
		nowFn: () => now,
		interactive: true,
		alertStore: {
			save: (s) => saved.push(s),
			load: () => restored,
		},
	});
	install(pi as never);
	const start = async () => {
		const { ctx, log } = freshCtx();
		await pi.emit("session_start", { reason: "new" }, ctx);
		return log;
	};
	const select = async () => {
		const { ctx, log } = freshCtx();
		await pi.emit("model_select", { model: { provider: CN, id: "glm-4.7" }, previousModel: undefined, source: "set" }, ctx);
		return log;
	};
	const turnEnd = async () => {
		const { ctx, log } = freshCtx();
		await pi.emit("turn_end", { turnIndex: 0, message: {}, toolResults: [] }, ctx);
		return log;
	};
	return { pi, select, start, turnEnd, saved, appendEntryCalls, tick: (ms: number) => { now += ms; } };
}

test("S1: 79 then 81 across turn boundaries emits exactly one warning", async () => {
	const h = harness({ queue: [{ status: "ok", snapshot: snapOf(79) }, { status: "ok", snapshot: snapOf(81) }] });
	const initial = await h.select();
	await settle();
	assert.equal(initial.notifications.length, 0, "below the tier");
	h.tick(181_000);
	const after = await h.turnEnd();
	await settle();
	const warnings = after.notifications.filter((n) => n.level === "warning");
	assert.equal(warnings.length, 1, "one warning on crossing");
	h.tick(181_000);
	const again = await h.turnEnd();
	await settle();
	assert.equal(again.notifications.filter((n) => n.level === "warning").length, 0, "no re-emit");
	assert.ok(h.saved.length >= 1, "state persisted");
});

test("S1: session restore from persisted state suppresses re-alerting in the same window", async () => {
	// First run: 81% observed, state persisted.
	const h1 = harness({ queue: [{ status: "ok", snapshot: snapOf(81) }] });
	await h1.select();
	await settle();
	assert.equal(h1.saved.length, 1);
	// Second run: same window, same percentage → no notification.
	const state = h1.saved.at(-1) ?? null;
	const h2 = harness({ queue: [{ status: "ok", snapshot: snapOf(81) }], saved: state });
	await h2.start();
	const log = await h2.select();
	await settle();
	assert.equal(log.notifications.filter((n) => /8\d%|80%/.test(n.message) || /used/.test(n.message)).length, 0, "restore suppresses re-alert");
});

test("S1: notify fires with warning level at 80, error at 95", async () => {
	const h = harness({ queue: [{ status: "ok", snapshot: snapOf(81) }] });
	const log = await h.select();
	await settle();
	const alert = log.notifications.find((n) => n.level === "warning" && /GLM/.test(n.message));
	assert.ok(alert, `expected a warning notify, got: ${JSON.stringify(log.notifications)}`);
	const h2 = harness({ queue: [{ status: "ok", snapshot: snapOf(96) }] });
	const log2 = await h2.select();
	await settle();
	assert.ok(log2.notifications.some((n) => n.level === "error" && /GLM/.test(n.message)), "error at 95");
});
