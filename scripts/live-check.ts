/**
 * Live verification helper (dev only — excluded from the npm file whitelist).
 *
 * Usage: npm run live-check [-- zai-coding-cn|zai]
 *
 * Ticket 01: prints key resolution for the real environment.
 * Ticket 02: will additionally fetch quota from the provider's monitor
 * endpoint and print the parsed snapshot.
 */

import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { PROVIDERS, createQuotaClient, piAgentDir, resolveKey, type ProviderId } from "../extensions/glm-usage.ts";

const arg = process.argv[2] ?? "zai-coding-cn";
if (arg !== "zai-coding-cn" && arg !== "zai") {
	console.error(`unknown provider "${arg}" (expected zai-coding-cn or zai)`);
	process.exit(1);
}
const provider = arg as ProviderId;
const configDir = piAgentDir(process.env, nodeOs.homedir());
const res = resolveKey(provider, {
	configDir,
	env: process.env as Record<string, string | undefined>,
	readFile(path) {
		try {
			return nodeFs.readFileSync(path, "utf8");
		} catch {
			return null;
		}
	},
});
const cfg = PROVIDERS[provider];
console.log(`provider   : ${provider}`);
console.log(`base URL   : ${cfg.baseUrl}`);
console.log(`config dir : ${configDir} (auth.json: ${nodePath.join(configDir, "auth.json")})`);
switch (res.status) {
	case "ok": {
		console.log(`key        : resolved via ${res.source} (${res.key.slice(0, 4)}…, length ${res.key.length})`);
		const client = createQuotaClient(provider, { fetchImpl: fetch });
		const out = await client.fetchQuota(res.key);
		if (out.status === "ok") {
			console.log(`level      : ${out.snapshot.level ?? "?"}`);
			for (const l of out.snapshot.limits) {
				const reset = l.nextResetTime ? new Date(l.nextResetTime).toISOString() : "none";
				console.log(`  unit ${String(l.unit).padStart(2)}  ${l.type.padEnd(12)} used ${String(l.percentage ?? "?").padStart(3)}%  reset ${reset}`);
			}
		} else if (out.status === "retry") {
			console.log(`quota      : retry suggested after ${out.retryAfterMs} ms`);
		} else {
			console.log(`quota      : ${out.message}`);
		}
		break;
	}
	case "conflict":
		console.log(`key        : CONFLICT — env differs from auth.json; auth.json key in use (${res.key.slice(0, 4)}…)`);
		break;
	default:
		console.log(`key        : ${res.status}`);
}
