import assert from "node:assert/strict";
import { test } from "node:test";
import { makeKeyDeps } from "./helpers.ts";
import { piAgentDir, resolveKey } from "../extensions/glm-usage.ts";
const CN = "zai-coding-cn";
const GLOBAL = "zai";
const authFile = (entries) => JSON.stringify(entries);
const cnEntry = authFile({ "zai-coding-cn": { type: "api_key", key: "file-key" } });
test("file absent + env set → ok from env", () => {
    const res = resolveKey(CN, makeKeyDeps({ env: { ZAI_CODING_CN_API_KEY: "env-key" } }));
    assert.deepEqual(res, { status: "ok", key: "env-key", source: "env" });
});
test("file absent + no env → no-key", () => {
    assert.equal(resolveKey(CN, makeKeyDeps({})).status, "no-key");
});
test("file entry + no env → ok from auth.json", () => {
    const res = resolveKey(CN, makeKeyDeps({ authRaw: cnEntry }));
    assert.deepEqual(res, { status: "ok", key: "file-key", source: "auth.json" });
});
test("file entry + identical env → ok, not a conflict", () => {
    const res = resolveKey(CN, makeKeyDeps({ authRaw: cnEntry, env: { ZAI_CODING_CN_API_KEY: "file-key" } }));
    assert.equal(res.status, "ok");
});
test("file entry + different env → conflict, auth.json wins", () => {
    const res = resolveKey(CN, makeKeyDeps({ authRaw: cnEntry, env: { ZAI_CODING_CN_API_KEY: "other" } }));
    assert.deepEqual(res, { status: "conflict", key: "file-key", source: "auth.json" });
});
test("file present, provider entry missing → env still applies (pi parity)", () => {
    const res = resolveKey(GLOBAL, makeKeyDeps({ authRaw: authFile({ deepseek: { type: "api_key", key: "x" } }), env: { ZAI_API_KEY: "env-key" } }));
    assert.deepEqual(res, { status: "ok", key: "env-key", source: "env" });
});
test("malformed JSON → explicit malformed state, never the parse error", () => {
    const res = resolveKey(CN, makeKeyDeps({ authRaw: "{not json" }));
    assert.equal(res.status, "malformed");
});
test("entry without string key → treated as absent entry", () => {
    const res = resolveKey(CN, makeKeyDeps({ authRaw: authFile({ "zai-coding-cn": { type: "oauth" } }) }));
    assert.equal(res.status, "no-key");
});
test("providers read distinct env vars and auth.json keys", () => {
    const res = resolveKey(GLOBAL, makeKeyDeps({ authRaw: authFile({ zai: { type: "api_key", key: "g-key" } }) }));
    assert.deepEqual(res, { status: "ok", key: "g-key", source: "auth.json" });
});
test("piAgentDir honors PI_CODING_AGENT_DIR override", () => {
    assert.equal(piAgentDir({ PI_CODING_AGENT_DIR: "/custom" }, "/home/u"), "/custom");
    assert.equal(piAgentDir({}, "/home/u"), "/home/u/.pi/agent");
});
