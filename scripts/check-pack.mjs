#!/usr/bin/env node
/**
 * Release gate: verify the npm tarball contains exactly the expected files.
 * Runs `npm pack --dry-run --json` and diffs the file list; exits 1 on any
 * unexpected or missing entry. Used by the release workflow before publish.
 */
import { execFileSync } from "node:child_process";

const EXPECTED = ["LICENSE", "README.md", "extensions/glm-usage.ts", "package.json"];

const out = execFileSync("pnpm", ["pack", "--dry-run", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
// pnpm emits a single pack object; npm emits an array of them.
const parsed: unknown = JSON.parse(out);
const entries = Array.isArray(parsed) ? (parsed as Array<{ files: Array<{ path: string }> }>) : [parsed as { files: Array<{ path: string }> }];
const files = entries.flatMap((entry) => entry.files.map((f) => f.path)).sort();
const expected = [...EXPECTED].sort();

const unexpected = files.filter((f) => !expected.includes(f));
const missing = expected.filter((f) => !files.includes(f));

if (unexpected.length > 0 || missing.length > 0) {
	if (unexpected.length > 0) console.error(`Unexpected files in tarball:\n  ${unexpected.join("\n  ")}`);
	if (missing.length > 0) console.error(`Missing files in tarball:\n  ${missing.join("\n  ")}`);
	console.error(`Expected exactly:\n  ${expected.join("\n  ")}`);
	process.exit(1);
}
console.log(`Tarball file list OK (${files.length} files).`);
