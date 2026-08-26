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
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
export const PROVIDERS = {
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
export function isGlmProvider(provider) {
    return provider === "zai-coding-cn" || provider === "zai";
}
/** Footer status slot — package-namespaced to avoid collisions. */
export const STATUS_KEY = "pi-glm-usage";
export function resolveKey(provider, deps) {
    const cfg = PROVIDERS[provider];
    const envKey = deps.env[cfg.envVar];
    // JSON.parse failures must never leak file content (Node ≥20 embeds
    // offending input in SyntaxError messages; auth.json holds every key).
    let raw;
    try {
        raw = deps.readFile(nodePath.join(deps.configDir, "auth.json"));
    }
    catch {
        raw = null;
    }
    if (raw === null) {
        return envKey ? { status: "ok", key: envKey, source: "env" } : { status: "no-key" };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { status: "malformed" };
    }
    const entry = parsed !== null && typeof parsed === "object"
        ? parsed[cfg.authJsonKey]
        : undefined;
    const fileKey = entry !== null && typeof entry === "object" && typeof entry.key === "string"
        ? entry.key
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
export function piAgentDir(env, homedir) {
    return env["PI_CODING_AGENT_DIR"] ?? nodePath.join(homedir, ".pi", "agent");
}
export function createExtension(deps) {
    return function install(pi) {
        // Generation counter: bumped on every model switch and shutdown so
        // late async work from a previous provider can be discarded (used by
        // later tickets; incremented here so the invariant exists from day 1).
        let generation = 0;
        const warnedConflict = new Set();
        const warnedNoKey = new Set();
        const warnedMalformed = new Set();
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
                        ctx.ui.notify(`pi-glm-usage: ${cfg.envVar} differs from auth.json; using the auth.json key.`, "warning");
                    }
                    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", cfg.label));
                    break;
                case "malformed":
                    if (!warnedMalformed.has(provider)) {
                        warnedMalformed.add(provider);
                        ctx.ui.notify("pi-glm-usage: auth.json is not valid JSON. Fix the file to activate the usage display.", "error");
                    }
                    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "GLM auth.json error"));
                    break;
                case "no-key":
                    if (!warnedNoKey.has(provider)) {
                        warnedNoKey.add(provider);
                        ctx.ui.notify(`pi-glm-usage: no API key for ${provider}. Add "${cfg.authJsonKey}" to auth.json or set ${cfg.envVar}.`, "warning");
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
// Default export — real filesystem/environment wiring.
// ---------------------------------------------------------------------------
export default function glmUsage(pi) {
    const homedir = nodeOs.homedir();
    createExtension({
        keyDepsFor(provider) {
            void provider;
            const env = process.env;
            return {
                configDir: piAgentDir(env, homedir),
                env,
                readFile(path) {
                    try {
                        return nodeFs.readFileSync(path, "utf8");
                    }
                    catch {
                        return null;
                    }
                },
            };
        },
    })(pi);
}
