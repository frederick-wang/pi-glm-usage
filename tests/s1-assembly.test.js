import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeCtx, fakePi, makeKeyDeps } from "./helpers.ts";
import { createExtension, STATUS_KEY } from "../extensions/glm-usage.ts";
const CN = "zai-coding-cn";
const GLOBAL = "zai";
function install(depsOpts) {
    const pi = fakePi();
    const installFn = createExtension({ keyDepsFor: () => makeKeyDeps(depsOpts) });
    installFn(pi);
    return pi;
}
async function selectModel(pi, provider) {
    const { ctx, ui } = fakeCtx();
    await pi.emit("model_select", { model: { provider, id: "glm-4.7" }, previousModel: undefined, source: "set" }, ctx);
    return ui;
}
test("registers lifecycle handlers without touching the host", () => {
    const pi = install({});
    const events = pi.registeredEvents();
    assert.ok(events.includes("model_select"), "model_select registered");
    assert.ok(events.includes("session_shutdown"), "session_shutdown registered");
});
test("healthy key: footer placeholder set, no notifications", async () => {
    const pi = install({ authRaw: JSON.stringify({ "zai-coding-cn": { key: "k" } }) });
    const ui = await selectModel(pi, CN);
    assert.equal(ui.notifications.length, 0);
    assert.equal(ui.status.at(-1)?.key, STATUS_KEY);
    assert.ok((ui.status.at(-1)?.text ?? "").length > 0);
});
test("switching to a non-GLM provider clears the footer", async () => {
    const pi = install({ env: { ZAI_CODING_CN_API_KEY: "k" } });
    await selectModel(pi, CN);
    const ui = await selectModel(pi, "anthropic");
    assert.equal(ui.status.at(-1)?.text, "");
});
test("no key: one warn notification, dim footer, no repeat on re-select", async () => {
    const pi = install({});
    const ui1 = await selectModel(pi, CN);
    assert.equal(ui1.notifications.length, 1);
    assert.match(ui1.notifications[0].message, /no API key/);
    const ui2 = await selectModel(pi, GLOBAL);
    assert.equal(ui2.notifications.length, 1, "separate provider warned once");
    const ui3 = await selectModel(pi, CN);
    assert.equal(ui3.notifications.length, 0, "second CN selection stays quiet");
});
test("malformed auth.json: explicit error state", async () => {
    const pi = install({ authRaw: "{oops" });
    const ui = await selectModel(pi, CN);
    assert.ok(ui.notifications.some((n) => n.level === "error" && /auth\.json/.test(n.message)));
    assert.match(ui.status.at(-1)?.text ?? "", /auth\.json/);
});
test("key conflict: one-time warn per provider, auth.json key used", async () => {
    const pi = install({
        authRaw: JSON.stringify({ "zai-coding-cn": { key: "file" }, zai: { key: "file" } }),
        env: { ZAI_CODING_CN_API_KEY: "different", ZAI_API_KEY: "different" },
    });
    const ui1 = await selectModel(pi, CN);
    assert.equal(ui1.notifications.length, 1);
    assert.match(ui1.notifications[0].message, /using the auth\.json key/);
    const ui2 = await selectModel(pi, GLOBAL);
    assert.equal(ui2.notifications.length, 1, "global provider warned once");
    const ui3 = await selectModel(pi, CN);
    assert.equal(ui3.notifications.length, 0, "no repeat warn for CN");
    assert.ok((ui3.status.at(-1)?.text ?? "").length > 0, "footer stays active");
});
