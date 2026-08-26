/**
 * pi-glm-usage — GLM Coding Plan usage display for the pi coding agent.
 *
 * Unofficial. Not affiliated with Zhipu AI / Z.ai. Polls the GLM Coding Plan
 * monitor endpoints (undocumented; observed in Zhipu's official tooling) while
 * a Zhipu plan provider (`zai-coding-cn` / `zai`) is active.
 *
 * Layout: provider map, key resolution, footer rendering helpers, quota
 * snapshot parser, monitor-endpoint client, extension assembly. Threshold
 * alerts and the report command arrive in later tickets (issues #5–#6).
 *
 * Erasable-syntax TypeScript only (Node type stripping runs this file
 * directly; tsconfig enforces erasableSyntaxOnly).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

// ---------------------------------------------------------------------------
// Provider map — single source of truth for both plan providers.
// ---------------------------------------------------------------------------

export type ProviderId = "zai-coding-cn" | "zai";

export interface ProviderConfig {
	/** Monitor API base URL. */
	baseUrl: string;
	/** Key under which pi stores the credential in auth.json. */
	authJsonKey: string;
	/** Environment variable pi accepts for this provider. */
	envVar: string;
	/** Auth scheme the official tooling uses for this endpoint. */
	preferredScheme: "raw" | "bearer";
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
	"zai-coding-cn": {
		baseUrl: "https://open.bigmodel.cn",
		authJsonKey: "zai-coding-cn",
		envVar: "ZAI_CODING_CN_API_KEY",
		preferredScheme: "raw",
	},
	zai: {
		baseUrl: "https://api.z.ai",
		authJsonKey: "zai",
		envVar: "ZAI_API_KEY",
		preferredScheme: "bearer",
	},
};

export function isGlmProvider(provider: string): provider is ProviderId {
	return provider === "zai-coding-cn" || provider === "zai";
}

// ---------------------------------------------------------------------------
// Messages — UI language (toasts, report labels, error guidance). The footer
// stays language-neutral; --json keeps stable English keys for scripts.
// Signal: PI_GLM_USAGE_LANG=zh|en overrides; else the process locale (a
// deliberately set Chinese shell locale counts as intent); else English.
// All helpers live in this single file: pi's loader treats every .ts under
// extensions/ as an extension module.
// ---------------------------------------------------------------------------

export type Lang = "en" | "zh";

export function resolveLang(env: Record<string, string | undefined>): Lang {
	const explicit = env["PI_GLM_USAGE_LANG"];
	if (explicit === "zh" || explicit === "en") return explicit;
	const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
	return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

type MsgVars = Record<string, string | number>;

const MESSAGES: Record<Lang, Record<string, (v: MsgVars) => string>> = {
	en: {
		reportTitle: () => "GLM Usage Report",
		segName5h: () => "5h window",
		segNameWeekly: () => "Weekly",
		segNameMcp: () => "MCP",
		segNameUnknown: (v) => `unit ${v.unit}`,
		resetsIn: (v) => `resets in ${v.t}`,
		modelUsage: () => "Model usage (last 24h):",
		toolUsage: () => "Tool usage (last 24h):",
		detailUnavailable: () => "Detail endpoints unavailable for this provider.",
		pressClose: () => "Press Enter or Esc to close",
		alertCrossed: (v) => `GLM ${v.label} quota at ${v.pct}% used (crossed ${v.tier}%)`,
		noKey: (v) => `pi-glm-usage: no API key for ${v.provider}. Add "${v.key}" to auth.json or set ${v.envVar}.`,
		malformed: () => "pi-glm-usage: auth.json is not valid JSON. Fix the file to activate the usage display.",
		conflict: (v) => `pi-glm-usage: ${v.envVar} differs from auth.json; using the auth.json key.`,
		rateLimited: () => "pi-glm-usage: the usage endpoint is rate-limiting; retry shortly.",
		jsonModeRestricted: () => "pi-glm-usage: --json requires TUI or print mode.",
		fetchFailed: () => "pi-glm-usage: usage fetch failed.",
		noKeyAny: () => "pi-glm-usage: no API key found for any GLM provider.",
	},
	zh: {
		reportTitle: () => "GLM 用量报告",
		segName5h: () => "5小时窗口",
		segNameWeekly: () => "周配额",
		segNameMcp: () => "MCP",
		segNameUnknown: (v) => `单元 ${v.unit}`,
		resetsIn: (v) => `${v.t} 后重置`,
		modelUsage: () => "模型用量（近 24 小时）：",
		toolUsage: () => "工具用量（近 24 小时）：",
		detailUnavailable: () => "该供应商暂无明细端点。",
		pressClose: () => "按 Enter 或 Esc 关闭",
		alertCrossed: (v) => `GLM ${v.label} 配额已用 ${v.pct}%（越过 ${v.tier}%）`,
		noKey: (v) => `pi-glm-usage：未找到 ${v.provider} 的 API key。请在 auth.json 添加 "${v.key}" 或设置 ${v.envVar}。`,
		malformed: () => "pi-glm-usage：auth.json 不是有效 JSON，修复后即可显示用量。",
		conflict: (v) => `pi-glm-usage：${v.envVar} 与 auth.json 的 key 不一致，将使用 auth.json 的。`,
		rateLimited: () => "pi-glm-usage：用量接口限流中，稍后重试。",
		jsonModeRestricted: () => "pi-glm-usage：--json 仅支持 TUI 或 print 模式。",
		fetchFailed: () => "pi-glm-usage：用量获取失败。",
		noKeyAny: () => "pi-glm-usage：未找到任何 GLM 供应商的 API key。",
	},
};

export function msg(lang: Lang, key: string, vars: MsgVars = {}): string {
	const fn = MESSAGES[lang][key] ?? MESSAGES.en[key];
	return fn ? fn(vars) : key;
}

/** Footer status slot — package-namespaced to avoid collisions. */
export const STATUS_KEY = "pi-glm-usage";

const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Key resolution — pure, injectable. Mirrors pi's own precedence:
// auth.json (under PI_CODING_AGENT_DIR) first, env fallback when the file has
// no entry for the provider. Malformed file is an explicit error, never a
// silent fallback to env (wrong-account risk).
// ---------------------------------------------------------------------------

export interface KeyDeps {
	readFile(path: string): string | null;
	env: Record<string, string | undefined>;
	configDir: string;
}

export type KeyResolution =
	| { status: "ok"; key: string; source: "auth.json" | "env" }
	| { status: "no-key" }
	| { status: "malformed" }
	| { status: "conflict"; key: string; source: "auth.json" };

export function resolveKey(provider: ProviderId, deps: KeyDeps): KeyResolution {
	const cfg = PROVIDERS[provider];
	const envKey = deps.env[cfg.envVar];

	// JSON.parse failures must never leak file content (Node ≥20 embeds
	// offending input in SyntaxError messages; auth.json holds every key).
	let raw: string | null;
	try {
		raw = deps.readFile(nodePath.join(deps.configDir, "auth.json"));
	} catch {
		raw = null;
	}
	if (raw === null) {
		return envKey ? { status: "ok", key: envKey, source: "env" } : { status: "no-key" };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { status: "malformed" };
	}

	const entry =
		parsed !== null && typeof parsed === "object"
			? (parsed as Record<string, unknown>)[cfg.authJsonKey]
			: undefined;
	const fileKey =
		entry !== null && typeof entry === "object" && typeof (entry as Record<string, unknown>).key === "string"
			? ((entry as Record<string, unknown>).key as string)
			: undefined;

	if (fileKey !== undefined) {
		if (envKey !== undefined && envKey !== fileKey) {
			return { status: "conflict", key: fileKey, source: "auth.json" };
		}
		return { status: "ok", key: fileKey, source: "auth.json" };
	}

	// File exists but carries no entry for this provider — pi itself would
	// still accept the env credential, so we do too.
	return envKey ? { status: "ok", key: envKey, source: "env" } : { status: "no-key" };
}

/** Resolve pi's agent config dir: PI_CODING_AGENT_DIR override, else ~/.pi/agent. */
export function piAgentDir(env: Record<string, string | undefined>, homedir: string): string {
	return env["PI_CODING_AGENT_DIR"] ?? nodePath.join(homedir, ".pi", "agent");
}

// ---------------------------------------------------------------------------
// Footer rendering — S3 pure helpers.
// ---------------------------------------------------------------------------

/** Footer labels for known units; unknown units are omitted from the footer. */
const FOOTER_LABELS: Record<number, string> = { 3: "5h", 6: "W", 5: "M" };
const FOOTER_ORDER = [3, 6, 5];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface FooterTheme {
	fg(role: string, text: string): string;
}

function colorRoleFor(pct: number | null): string {
	if (pct === null) return "dim";
	if (pct < 50) return "success";
	if (pct < 80) return "warning";
	return "error";
}

/** Human-readable remaining time for a reset timestamp; "" when past/invalid. */
export function formatReset(resetMs: number | undefined, now: number): string {
	if (resetMs === undefined || !Number.isFinite(resetMs) || resetMs <= now) return "";
	const diff = resetMs - now;
	if (diff < 24 * HOUR_MS) {
		const h = Math.floor(diff / HOUR_MS);
		const m = Math.floor((diff % HOUR_MS) / 60_000);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
	const at = new Date(resetMs);
	if (diff < 7 * 24 * HOUR_MS) {
		const hh = String(at.getHours()).padStart(2, "0");
		const mm = String(at.getMinutes()).padStart(2, "0");
		return `${WEEKDAYS[at.getDay()]} ${hh}:${mm}`;
	}
	return `${MONTHS[at.getMonth()]}${String(at.getDate()).padStart(2, "0")}`;
}

export function renderFooter(snapshot: Snapshot, opts: { now: number; stale?: boolean; theme?: FooterTheme }): string {
	const displayed = FOOTER_ORDER.filter((u) => snapshot.limits.some((l) => l.unit === u)).slice(0, 2);
	const parts = displayed.map((unit) => ({ unit, limit: snapshot.limits.find((l) => l.unit === unit)! }));
	const nearest = parts
		.filter((p) => p.limit.nextResetTime !== undefined)
		.sort((a, b) => (a.limit.nextResetTime ?? 0) - (b.limit.nextResetTime ?? 0))[0];
	const segs = parts.map((p, i) => {
		const pctText = p.limit.percentage === null ? "?" : String(p.limit.percentage);
		const staleSuffix = opts.stale && i === 0 ? "~" : "";
		const chunk = `${FOOTER_LABELS[p.unit]} ${pctText}%${staleSuffix}`;
		const colored = opts.theme ? opts.theme.fg(colorRoleFor(p.limit.percentage), chunk) : chunk;
		const reset = nearest && nearest.unit === p.unit ? formatReset(p.limit.nextResetTime, opts.now) : "";
		return reset ? `${colored}↻${reset}` : colored;
	});
	return `GLM ${segs.join("·")}`;
}

const shanghaiFormatter = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Shanghai",
	hourCycle: "h23",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});

/** ADR-0002: monitor-endpoint window params are naive Asia/Shanghai time. */
export function formatShanghaiTimestamp(ms: number): string {
	const parts = Object.fromEntries(shanghaiFormatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
	return `${parts["year"]}-${parts["month"]}-${parts["day"]} ${parts["hour"]}:${parts["minute"]}:${parts["second"]}`;
}

/** Detail-window params: yesterday-same-hour → now, in Asia/Shanghai. */
export function shanghaiWindow(nowMs: number): { startTime: string; endTime: string } {
	return { startTime: formatShanghaiTimestamp(nowMs - 24 * HOUR_MS), endTime: formatShanghaiTimestamp(nowMs) };
}

// ---------------------------------------------------------------------------
// Quota snapshot — parse + range guards (S3 pure helpers).
// ---------------------------------------------------------------------------

export interface QuotaLimit {
	/** Monitor API unit code: 3 = 5h window, 5 = MCP, 6 = weekly; unknown codes are carried generically. */
	unit: number;
	/** Raw limit type string, e.g. "TOKENS_LIMIT" / "TIME_LIMIT". */
	type: string;
	/** Used percentage, integer 0–100; null when out of range or non-numeric. */
	percentage: number | null;
	/** Epoch-ms reset time when present and positive. */
	nextResetTime: number | undefined;
}

export interface Snapshot {
	level: string | undefined;
	limits: QuotaLimit[];
}

export function parseQuotaResponse(raw: unknown): Snapshot | null {
	if (raw === null || typeof raw !== "object") return null;
	const envelope = raw as { code?: unknown; data?: unknown };
	if (envelope.code !== 200) return null;
	const data = envelope.data;
	if (data === null || typeof data !== "object") return null;
	const limitsRaw = (data as { limits?: unknown }).limits;
	if (!Array.isArray(limitsRaw)) return null;
	const limits: QuotaLimit[] = [];
	for (const item of limitsRaw) {
		if (item === null || typeof item !== "object") continue;
		const entry = item as Record<string, unknown>;
		const unit = entry["unit"];
		const type = entry["type"];
		if (typeof unit !== "number" || !Number.isInteger(unit) || typeof type !== "string") continue;
		if (limits.some((l) => l.unit === unit)) continue;
		const pctRaw = entry["percentage"];
		const percentage =
			typeof pctRaw === "number" && Number.isInteger(pctRaw) && pctRaw >= 0 && pctRaw <= 100 ? pctRaw : null;
		const resetRaw = entry["nextResetTime"];
		const nextResetTime =
			typeof resetRaw === "number" && Number.isFinite(resetRaw) && resetRaw > 0 ? resetRaw : undefined;
		limits.push({ unit, type, percentage, nextResetTime });
	}
	const levelRaw = (data as { level?: unknown }).level;
	return { level: typeof levelRaw === "string" ? levelRaw : undefined, limits };
}

// ---------------------------------------------------------------------------
// Quota client — the only module that talks to the monitor endpoints (S2).
// ---------------------------------------------------------------------------

export const ERR_AUTH = "pi-glm-usage: the usage endpoint rejected the API key";
export const ERR_PARSE = "pi-glm-usage: unexpected response from the usage endpoint";
export const ERR_TIMEOUT = "pi-glm-usage: the usage endpoint timed out";

export type QuotaResult =
	| { status: "ok"; snapshot: Snapshot }
	| { status: "retry"; retryAfterMs: number }
	| { status: "error"; message: string };

export interface QuotaClientDeps {
	fetchImpl: typeof fetch;
	/** Request timeout; default 4000 ms. */
	timeoutMs?: number;
}

interface SchemeState {
	scheme: "raw" | "bearer";
	consecutiveAuthFailures: number;
	breakerOpen: boolean;
}

export function createQuotaClient(provider: ProviderId, deps: QuotaClientDeps) {
	const cfg = PROVIDERS[provider];
	const timeoutMs = deps.timeoutMs ?? 4000;
	const state: SchemeState = { scheme: cfg.preferredScheme, consecutiveAuthFailures: 0, breakerOpen: false };

	const authorization = (scheme: "raw" | "bearer", key: string) => (scheme === "raw" ? key : `Bearer ${key}`);

	async function attempt(key: string, scheme: "raw" | "bearer"): Promise<Response> {
		return deps.fetchImpl(`${cfg.baseUrl}/api/monitor/usage/quota/limit`, {
			headers: {
				Authorization: authorization(scheme, key),
				"Accept-Language": "en-US,en",
				"Content-Type": "application/json",
				"User-Agent": "pi-glm-usage/0.1.0",
			},
			signal: AbortSignal.timeout(timeoutMs),
		});
	}

	function other(scheme: "raw" | "bearer"): "raw" | "bearer" {
		return scheme === "raw" ? "bearer" : "raw";
	}

	async function fetchQuota(key: string): Promise<QuotaResult> {
		if (state.breakerOpen) return { status: "error", message: ERR_AUTH };
		let res: Response;
		try {
			res = await attempt(key, state.scheme);
		} catch (err) {
			const name = err instanceof Error ? err.name : "";
			return name === "TimeoutError" || name === "AbortError"
				? { status: "error", message: ERR_TIMEOUT }
				: { status: "error", message: ERR_PARSE };
		}
		if (res.status === 401) {
			let fallback: Response;
			try {
				fallback = await attempt(key, other(state.scheme));
			} catch {
				return { status: "error", message: ERR_TIMEOUT };
			}
			if (fallback.status === 401) {
				state.consecutiveAuthFailures += 1;
				if (state.consecutiveAuthFailures >= 2) state.breakerOpen = true;
				return { status: "error", message: ERR_AUTH };
			}
			state.scheme = other(state.scheme);
			state.consecutiveAuthFailures = 0;
			res = fallback;
		} else if (res.status === 429 || res.status >= 500) {
			const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
			return { status: "retry", retryAfterMs };
		}
		let body: unknown;
		try {
			body = await res.json();
		} catch {
			return { status: "error", message: ERR_PARSE };
		}
		const snapshot = parseQuotaResponse(body);
		if (!snapshot) return { status: "error", message: ERR_PARSE };
		state.consecutiveAuthFailures = 0;
		return { status: "ok", snapshot };
	}

	function resetBreaker(): void {
		state.breakerOpen = false;
		state.consecutiveAuthFailures = 0;
	}

	/**
	 * Best-effort detail fetch (model-usage / tool-usage); null degrades the
	 * report. Live-verified CN shape: data.modelSummaryList for models,
	 * data.toolSummaryList for tools; both [{ name-ish, totalTokens-or-count }].
	 */
	async function fetchDetail(
		kind: "model-usage" | "tool-usage",
		key: string,
		win: { startTime: string; endTime: string },
	): Promise<{ items: unknown[] } | null> {
		const url = `${cfg.baseUrl}/api/monitor/usage/${kind}?startTime=${encodeURIComponent(win.startTime)}&endTime=${encodeURIComponent(win.endTime)}`;
		try {
			const res = await deps.fetchImpl(url, {
				headers: { Authorization: authorization(state.scheme, key), "Accept-Language": "en-US,en", "User-Agent": "pi-glm-usage/0.1.0" },
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!res.ok) return null;
			const body = (await res.json()) as { code?: unknown; data?: unknown };
			if (body.code !== 200 || body.data === null || typeof body.data !== "object") return null;
			const data = body.data as Record<string, unknown>;
			const summary = kind === "model-usage" ? data["modelSummaryList"] : data["toolSummaryList"];
			return Array.isArray(summary) ? { items: summary } : null;
		} catch {
			return null;
		}
	}

	return { fetchQuota, fetchDetail, resetBreaker };
}

function parseRetryAfter(value: string | null): number {
	if (value === null) return 60_000;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(value);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return 60_000;
}

// ---------------------------------------------------------------------------
// Threshold alerts — S3 pure evaluator + S1 wiring.
// Dedup key: (provider, unit). Window identity: nextResetTime within
// ±15min (live-verified stable within a window). A drop of ≥20 points
// re-arms both tiers. First observation above a tier emits the highest only.
// ---------------------------------------------------------------------------

export interface AlertUnitState {
	anchor: number | null;
	lastPct: number | null;
	alerted80: boolean;
	alerted95: boolean;
}

export type AlertState = Record<string, AlertUnitState>;

export interface AlertEmission {
	unit: number;
	tier: 80 | 95;
}

const ALERT_TOLERANCE_MS = 15 * 60_000;
const ALERT_DROP_REARM = 20;

export function evaluateAlerts(
	state: AlertState | null,
	provider: ProviderId,
	snapshot: Snapshot,
): { emitted: AlertEmission[]; state: AlertState } {
	const next: AlertState = { ...(state ?? {}) };
	const emitted: AlertEmission[] = [];
	for (const limit of snapshot.limits) {
		if (limit.percentage === null) continue;
		const pct = limit.percentage;
		const key = `${provider}:${limit.unit}`;
		const prev = next[key];
		let anchor = prev?.anchor ?? null;
		let alerted80 = prev?.alerted80 ?? false;
		let alerted95 = prev?.alerted95 ?? false;
		const cur = limit.nextResetTime;
		if (anchor !== null && cur !== undefined && Math.abs(cur - anchor) > ALERT_TOLERANCE_MS) {
			anchor = cur;
			alerted80 = false;
			alerted95 = false;
		} else if (anchor === null && cur !== undefined) {
			anchor = cur;
		}
		const lastPct = prev?.lastPct ?? null;
		if (lastPct !== null && lastPct - pct >= ALERT_DROP_REARM) {
			alerted80 = false;
			alerted95 = false;
		}
		if (pct >= 95) {
			if (!alerted95) emitted.push({ unit: limit.unit, tier: 95 });
			alerted95 = true;
			alerted80 = true;
		} else if (pct >= 80) {
			if (!alerted80) emitted.push({ unit: limit.unit, tier: 80 });
			alerted80 = true;
		}
		next[key] = { anchor, lastPct: pct, alerted80, alerted95 };
	}
	return { emitted, state: next };
}

// ---------------------------------------------------------------------------
// Report building — S3 pure helpers (rendered in the overlay / --json).
// ---------------------------------------------------------------------------


export interface ReportDetail {
	models: unknown[] | null;
	tools: unknown[] | null;
}

export function formatDetailItem(item: unknown): string {
	if (item === null || typeof item !== "object") return JSON.stringify(item);
	const o = item as Record<string, unknown>;
	const label = [o["modelName"], o["modelCode"], o["toolName"], o["tool"], o["name"], o["client"]].find(
		(v): v is string => typeof v === "string",
	) ?? null;
	const value = [o["totalTokens"], o["usage"], o["count"], o["value"]].find(
		(v) => typeof v === "number" || typeof v === "string",
	) ?? null;
	if (label !== null && value !== null) return `${label}  ${String(value)}`;
	return JSON.stringify(item);
}

const REPORT_SEGMENT_KEYS: Record<number, string> = { 3: "segName5h", 6: "segNameWeekly", 5: "segNameMcp" };

export function buildReportText(
	snapshot: Snapshot,
	detail: ReportDetail,
	opts: { now: number; lang?: Lang },
): string {
	const lang = opts.lang ?? "en";
	const lines: string[] = [];
	const usedLabel = lang === "zh" ? "已用" : "used";
	lines.push(`GLM Coding Plan${snapshot.level ? ` — ${snapshot.level}` : ""}`);
	for (const l of snapshot.limits) {
		const key = REPORT_SEGMENT_KEYS[l.unit];
		const name = key ? msg(lang, key) : msg(lang, "segNameUnknown", { unit: l.unit });
		const pct = l.percentage === null ? (lang === "zh" ? "未知" : "unknown") + "%" : `${l.percentage}% ${usedLabel}`;
		const reset = formatReset(l.nextResetTime, opts.now);
		lines.push(`  ${name.padEnd(lang === "zh" ? 12 : 12)}${pct}${reset ? `   ${msg(lang, "resetsIn", { t: reset })}` : ""}`);
	}
	if (detail.models !== null || detail.tools !== null) {
		if (detail.models !== null) {
			lines.push("", `${msg(lang, "modelUsage")}`);
			for (const m of detail.models) lines.push(`  ${formatDetailItem(m)}`);
		}
		if (detail.tools !== null) {
			lines.push("", `${msg(lang, "toolUsage")}`);
			for (const t of detail.tools) lines.push(`  ${formatDetailItem(t)}`);
		}
	} else {
		lines.push("", msg(lang, "detailUnavailable"));
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension assembly — S1 seam. All effects go through ctx.ui; every
// degradation is a footer/notify state, never a thrown error.
// ---------------------------------------------------------------------------

export interface QuotaClientLike {
	fetchQuota(key: string): Promise<QuotaResult>;
	fetchDetail(
		kind: "model-usage" | "tool-usage",
		key: string,
		win: { startTime: string; endTime: string },
	): Promise<{ items: unknown[] } | null>;
	resetBreaker(): void;
}

export interface UiLike {
	setStatus(key: string, text?: string): void;
	notify(message: string, level?: string): void;
	theme: FooterTheme;
}

export interface AlertStore {
	save(state: AlertState): void;
	load(): AlertState | null;
}

export interface ExtensionDeps {
	keyDepsFor(provider: ProviderId): KeyDeps;
	env?: Record<string, string | undefined>;
	quotaClientFor(provider: ProviderId): QuotaClientLike;
	nowFn?(): number;
	/** Test override for the interactive-mode check. */
	interactive?: boolean;
	setInterval?: typeof setInterval;
	clearInterval?: typeof clearInterval;
	alertStore?: AlertStore;
}

const ALERT_ENTRY_TYPE = "pi-glm-usage-alerts";

const THROTTLE_MS = 180_000;
const THROTTLE_HIGH_USAGE_MS = 60_000;
const COUNTDOWN_TICK_MS = 30_000;

export function createExtension(deps: ExtensionDeps) {
	const now = () => (deps.nowFn ?? Date.now)();
	const setIntervalImpl = deps.setInterval ?? setInterval;
	const clearIntervalImpl = deps.clearInterval ?? clearInterval;
	// Interactive-mode gate. Evaluated per event from host-provided ctx
	// (mode/hasUI), not stdout.isTTY: `pi -p` attached to a terminal still
	// has a TTY but must not poll or start timers.
	const isInteractive = (ctx: { mode?: string; hasUI?: boolean }) =>
		deps.interactive ?? (ctx.mode === "tui" || ctx.hasUI === true);
	return function install(pi: ExtensionAPI): void {
		// Generation counter: bumped on every model switch and shutdown so
		// late async work from a previous provider/state is discarded.
		let generation = 0;
		const warnedConflict = new Set<ProviderId>();
		const warnedNoKey = new Set<ProviderId>();
		const warnedMalformed = new Set<ProviderId>();

		let active: ProviderId | null = null;
		let apiKey: string | null = null;
		let snapshot: Snapshot | null = null;
		let stale = false;
		let lastFetchAt = Number.NEGATIVE_INFINITY;
		let inFlight = false;
		let timer: ReturnType<typeof setIntervalImpl> | null = null;
		let timerRunning = false;
		// Persistent UI handle for interval-driven re-renders (countdown ticks).
		let lastUi: UiLike | null = null;
		let alertState: AlertState | null = null;
		const lang = resolveLang(deps.env ?? {});
		const alertStore: AlertStore =
			deps.alertStore ?? {
				save: (s) => {
					try {
						(pi as { appendEntry?: (type: string, data: unknown) => void }).appendEntry?.(ALERT_ENTRY_TYPE, s);
					} catch {
						// Persistence is best-effort; per-session dedup still applies.
					}
				},
				load: () => null,
			};

		const throttleMs = () =>
			snapshot && snapshot.limits.some((l) => (l.unit === 3 || l.unit === 6) && (l.percentage ?? 0) >= 80)
				? THROTTLE_HIGH_USAGE_MS
				: THROTTLE_MS;

		function clearTimer(): void {
			if (timer !== null) {
				clearIntervalImpl(timer as never);
				timer = null;
			}
			timerRunning = false;
		}

		function render(ui: UiLike): void {
			if (active === null) {
				ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			if (snapshot === null) {
				ui.setStatus(STATUS_KEY, ui.theme.fg("dim", "GLM …"));
				return;
			}
			ui.setStatus(STATUS_KEY, renderFooter(snapshot, { now: now(), stale, theme: ui.theme }));
		}

		function refresh(ctx: { ui: UiLike; mode?: string; hasUI?: boolean }, force = false): void {
			lastUi = ctx.ui;
			if (!isInteractive(ctx) || active === null || apiKey === null || inFlight) return;
			if (!force && now() - lastFetchAt < throttleMs()) return;
			inFlight = true;
			lastFetchAt = now();
			const gen = generation;
			const ui = ctx.ui;
			deps.quotaClientFor(active)
				.fetchQuota(apiKey)
				.then((res) => {
					if (gen !== generation) return;
					if (res.status === "ok") {
						snapshot = res.snapshot;
						stale = false;
						const alerts = evaluateAlerts(alertState, active as ProviderId, res.snapshot);
						alertState = alerts.state;
						alertStore.save(alertState);
						for (const e of alerts.emitted) {
							const label = FOOTER_LABELS[e.unit] ?? `unit ${e.unit}`;
							const pct = res.snapshot.limits.find((l) => l.unit === e.unit)?.percentage ?? "?";
							ui.notify(msg(lang, "alertCrossed", { label, pct: String(pct), tier: String(e.tier) }), e.tier === 95 ? "error" : "warning");
						}
					} else if (res.status === "retry") {
						lastFetchAt = now() + res.retryAfterMs;
					} else if (snapshot !== null) {
						stale = true;
					}
					render(ui);
				})
				.catch(() => {
					if (gen !== generation) return;
					if (snapshot !== null) stale = true;
					render(ui);
				})
				.finally(() => {
					inFlight = false;
				});
		}

		pi.on("model_select", async (event, ctx) => {
			generation += 1;
			lastUi = ctx.ui;
			const provider = event.model.provider;
			if (!isGlmProvider(provider)) {
				active = null;
				apiKey = null;
				snapshot = null;
				stale = false;
				clearTimer();
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			const cfg = PROVIDERS[provider];
			const res = resolveKey(provider, deps.keyDepsFor(provider));
			switch (res.status) {
				case "ok":
				case "conflict": {
					if (res.status === "conflict" && !warnedConflict.has(provider)) {
						warnedConflict.add(provider);
						ctx.ui.notify(msg(lang, "conflict", { envVar: cfg.envVar }), "warning");
					}
					active = provider;
					apiKey = res.key;
					snapshot = null;
					stale = false;
					deps.quotaClientFor(provider).resetBreaker();
					render(ctx.ui);
					refresh(ctx, true);
					break;
				}
				case "malformed": {
					active = null;
					apiKey = null;
					if (!warnedMalformed.has(provider)) {
						warnedMalformed.add(provider);
						ctx.ui.notify(msg(lang, "malformed"), "error");
					}
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "GLM auth.json error"));
					break;
				}
				case "no-key": {
					active = null;
					apiKey = null;
					if (!warnedNoKey.has(provider)) {
						warnedNoKey.add(provider);
						ctx.ui.notify(msg(lang, "noKey", { provider, key: cfg.authJsonKey, envVar: cfg.envVar }), "warning");
					}
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "GLM no key"));
					break;
				}
			}
		});

		async function showOverlay(text: string, ctx: { ui: UiLike & { custom(factory: unknown, opts?: unknown): Promise<unknown> } }): Promise<void> {
			await ctx.ui.custom(
				(_tui: unknown, theme: FooterTheme, _kb: unknown, done: (value: unknown) => void) => {
					// Zero-dependency overlay: plain text lines joined per render.
					// Enter (\r / \n) and Esc (\x1b) close; factory args provide
					// the theme, so no runtime import from pi-tui is needed.
					const lines = [`  ${theme.fg("accent", msg(lang, "reportTitle"))}`, "", ...text.split("\n"), "", `  ${theme.fg("dim", msg(lang, "pressClose"))}`];
					return {
						render: (width: number) => lines.map((l) => l.slice(0, Math.max(0, width))).join("\n"),
						invalidate: () => {},
						handleInput: (data: string) => {
							if (data === "\r" || data === "\n" || data === "\x1b") done(undefined);
						},
					};
				},
				{ overlay: true },
			);
		}

		pi.registerCommand("glm-usage", {
			description: "Show GLM Coding Plan usage (add --json for raw output)",
			handler: async (args: string, ctx: { mode?: string; ui: UiLike & { custom(factory: unknown, opts?: unknown): Promise<unknown> } }) => {
				// Provider: active GLM provider, else the first provider with a resolvable key.
				let provider: ProviderId | null = active;
				let key: string | null = apiKey;
				if (provider === null || key === null) {
					for (const p of ["zai-coding-cn", "zai"] as ProviderId[]) {
						const r = resolveKey(p, deps.keyDepsFor(p));
						if (r.status === "ok" || r.status === "conflict") {
							provider = p;
							key = r.key;
							break;
						}
					}
				}
				if (provider === null || key === null) {
					ctx.ui.notify(msg(lang, "noKeyAny"), "error");
					return;
				}
				const client = deps.quotaClientFor(provider);
				const res = await client.fetchQuota(key);
				if (res.status !== "ok") {
					ctx.ui.notify(
						res.status === "retry"
							? msg(lang, "rateLimited")
							: (res as { message?: string }).message ?? "pi-glm-usage: usage fetch failed.",
						"error",
					);
					return;
				}
				if (provider === active) {
					snapshot = res.snapshot;
					stale = false;
					render(ctx.ui);
				}
				const win = shanghaiWindow(now());
				const [models, tools] = await Promise.all([
					client.fetchDetail("model-usage", key, win),
					client.fetchDetail("tool-usage", key, win),
				]);
				const wantJson = args.includes("--json");
				if (wantJson) {
					const payload = JSON.stringify(
						{ provider, quota: res.snapshot, window: win, detail: { models, tools } },
						null,
						2,
					);
					if (ctx.mode === "tui") {
						await showOverlay(payload, ctx);
					} else if (ctx.mode === "print") {
						// Only print mode owns stdout; RPC stdout is the protocol.
						console.log(payload);
					} else {
						ctx.ui.notify(msg(lang, "jsonModeRestricted"), "warning");
					}
					return;
				}
				const text = buildReportText(res.snapshot, { models: models?.items ?? null, tools: tools?.items ?? null }, { now: now(), lang });
				if (ctx.mode === "tui") {
					await showOverlay(text, ctx);
				} else {
					const pct = res.snapshot.limits.find((l) => l.unit === 3)?.percentage;
					ctx.ui.notify(`GLM 5h window: ${pct === null || pct === undefined ? "unknown" : `${pct}%`} used`, "info");
				}
			},
		});

		pi.on("session_start", async (event, ctx) => {
			// Seed activation from the session's model: model_select only fires
			// on /model, cycling, or restore — a plain startup with a GLM
			// default model would otherwise never activate the footer.
			const startupModel =
				(event as { model?: { provider?: string } }).model ?? (ctx as { model?: { provider?: string } }).model;
			const startupProvider: string | undefined = startupModel?.provider;
			if (startupProvider !== undefined && isGlmProvider(startupProvider)) {
				const provider: ProviderId = startupProvider;
				const res = resolveKey(provider, deps.keyDepsFor(provider));
				if (res.status === "ok" || res.status === "conflict") {
					active = provider;
					apiKey = res.key;
					deps.quotaClientFor(provider).resetBreaker();
					render(ctx.ui);
				}
			}
			// Restore alert dedup state from the session log (last entry wins).
			try {
				const entries = (ctx as { sessionManager?: { getEntries?: () => unknown[] } }).sessionManager?.getEntries?.() ?? [];
				for (let i = entries.length - 1; i >= 0; i -= 1) {
					const e = entries[i] as { type?: string; customType?: string; data?: unknown };
					if (e.type === "custom" && e.customType === ALERT_ENTRY_TYPE && e.data && typeof e.data === "object") {
						alertState = e.data as AlertState;
						break;
					}
				}
			} catch {
				alertState = null;
			}
			const loaded = alertStore.load();
			if (loaded) alertState = loaded;
			if (active !== null && apiKey !== null) refresh(ctx, false);
		});

		pi.on("turn_end", async (_event, ctx) => {
			refresh(ctx, false);
		});

		pi.on("agent_start", async (_event, ctx) => {
			lastUi = ctx.ui;
			if (!isInteractive(ctx) || active === null || timerRunning) return;
			timerRunning = true;
			timer = setIntervalImpl(() => {
				// Countdown re-render from the cached snapshot; no network.
				if (lastUi && snapshot !== null && active !== null) render(lastUi);
			}, COUNTDOWN_TICK_MS);
			timer?.unref?.();
		});

		pi.on("agent_end", async () => {
			clearTimer();
		});

		pi.on("session_shutdown", async () => {
			generation += 1;
			clearTimer();
		});
	};
}

// ---------------------------------------------------------------------------
// Default export — real filesystem/environment/network wiring.
// ---------------------------------------------------------------------------

export default function glmUsage(pi: ExtensionAPI): void {
	const homedir = nodeOs.homedir();
	const keyDepsFor = (provider: ProviderId): KeyDeps => {
		void provider;
		const env = process.env as Record<string, string | undefined>;
		return {
			configDir: piAgentDir(env, homedir),
			env,
			readFile(path) {
				try {
					return nodeFs.readFileSync(path, "utf8");
				} catch {
					return null;
				}
			},
		};
	};
	const clients = new Map<ProviderId, QuotaClientLike>();
	const quotaClientFor = (provider: ProviderId): QuotaClientLike => {
		let c = clients.get(provider);
		if (!c) {
			c = createQuotaClient(provider, { fetchImpl: fetch });
			clients.set(provider, c);
		}
		return c;
	};
	createExtension({ env: process.env as Record<string, string | undefined>, keyDepsFor, quotaClientFor })(pi);
}
