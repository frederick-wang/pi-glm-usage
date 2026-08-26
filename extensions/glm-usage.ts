/**
 * pi-glm-usage — GLM Coding Plan usage display for the pi coding agent.
 *
 * Unofficial. Not affiliated with Zhipu AI / Z.ai. Polls the GLM Coding Plan
 * monitor endpoints (undocumented; observed in Zhipu's official tooling) while
 * a Zhipu plan provider (`zai-coding-cn` / `zai`) is active.
 *
 * Ticket 01 scope: provider map, key resolution (auth.json → env, pi
 * precedence), failure states surfaced through notify/footer, lifecycle
 * scaffolding. Quota fetching, footer rendering, alerts, and the report
 * command arrive in later tickets (issues #3–#6).
 *
 * Erasable-syntax TypeScript only (Node type stripping runs this file
 * directly): no enums, no namespaces, no parameter properties.
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
	/** Short footer label. */
	label: string;
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
		label: "GLM",
		baseUrl: "https://open.bigmodel.cn",
		authJsonKey: "zai-coding-cn",
		envVar: "ZAI_CODING_CN_API_KEY",
		preferredScheme: "raw",
	},
	zai: {
		label: "GLM",
		baseUrl: "https://api.z.ai",
		authJsonKey: "zai",
		envVar: "ZAI_API_KEY",
		preferredScheme: "bearer",
	},
};

export function isGlmProvider(provider: string): provider is ProviderId {
	return provider === "zai-coding-cn" || provider === "zai";
}

/** Footer status slot — package-namespaced to avoid collisions. */
export const STATUS_KEY = "pi-glm-usage";

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
// Extension assembly — S1 seam. All effects go through ctx.ui; every
// degradation is a footer/notify state, never a thrown error.
// ---------------------------------------------------------------------------

export interface ExtensionDeps {
	keyDepsFor(provider: ProviderId): KeyDeps;
}

export function createExtension(deps: ExtensionDeps) {
	return function install(pi: ExtensionAPI): void {
		// Generation counter: bumped on every model switch and shutdown so
		// late async work from a previous provider can be discarded (used by
		// later tickets; incremented here so the invariant exists from day 1).
		let generation = 0;
		const warnedConflict = new Set<ProviderId>();
		const warnedNoKey = new Set<ProviderId>();
		const warnedMalformed = new Set<ProviderId>();

		pi.on("model_select", async (event, ctx) => {
			generation += 1;
			const provider = event.model.provider;
			if (!isGlmProvider(provider)) {
				ctx.ui.setStatus(STATUS_KEY, "");
				return;
			}
			const cfg = PROVIDERS[provider];
			const res = resolveKey(provider, deps.keyDepsFor(provider));
			switch (res.status) {
				case "ok":
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", cfg.label));
					break;
				case "conflict":
					if (!warnedConflict.has(provider)) {
						warnedConflict.add(provider);
						ctx.ui.notify(
							`pi-glm-usage: ${cfg.envVar} differs from auth.json; using the auth.json key.`,
							"warning",
						);
					}
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", cfg.label));
					break;
				case "malformed":
					if (!warnedMalformed.has(provider)) {
						warnedMalformed.add(provider);
						ctx.ui.notify(
							"pi-glm-usage: auth.json is not valid JSON. Fix the file to activate the usage display.",
							"error",
						);
					}
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "GLM auth.json error"));
					break;
				case "no-key":
					if (!warnedNoKey.has(provider)) {
						warnedNoKey.add(provider);
						ctx.ui.notify(
							`pi-glm-usage: no API key for ${provider}. Add "${cfg.authJsonKey}" to auth.json or set ${cfg.envVar}.`,
							"warning",
						);
					}
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "GLM no key"));
					break;
			}
		});

		pi.on("session_shutdown", async () => {
			generation += 1;
		});
	};
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
	/** Preferred scheme failed once and the other one worked. */
	scheme: "raw" | "bearer";
	/** Consecutive rejections on both schemes. */
	consecutiveAuthFailures: number;
	/** Breaker open: refuse further requests until resetBreaker(). */
	breakerOpen: boolean;
}

export function createQuotaClient(provider: ProviderId, deps: QuotaClientDeps) {
	const cfg = PROVIDERS[provider];
	const timeoutMs = deps.timeoutMs ?? 4000;
	const state: SchemeState = { scheme: cfg.preferredScheme, consecutiveAuthFailures: 0, breakerOpen: false };

	const authorization = (scheme: "raw" | "bearer", key: string) =>
		scheme === "raw" ? key : `Bearer ${key}`;

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
		// Any 2xx carries the envelope; parseQuotaResponse validates the shape.
		const snapshot = parseQuotaResponse(body);
		if (!snapshot) return { status: "error", message: ERR_PARSE };
		state.consecutiveAuthFailures = 0;
		return { status: "ok", snapshot };
	}

	function resetBreaker(): void {
		state.breakerOpen = false;
		state.consecutiveAuthFailures = 0;
	}

	return { fetchQuota, resetBreaker };
}

function parseRetryAfter(value: string | null): number {
	if (value === null) return 60_000;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(value);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return 60_000;
}

export default function glmUsage(pi: ExtensionAPI): void {
	const homedir = nodeOs.homedir();
	createExtension({
		keyDepsFor(provider) {
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
		},
	})(pi);
}
