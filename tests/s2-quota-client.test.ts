import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeFetch } from "./helpers.ts";
import { createQuotaClient, ERR_AUTH, ERR_PARSE } from "../extensions/glm-usage.ts";

const CN = "zai-coding-cn";
const GLOBAL = "zai";
const OK = { code: 200, data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 6, nextResetTime: 1787784543214 }], level: "max" } };

function makeClient(provider: "zai-coding-cn" | "zai", responses: Parameters<typeof fakeFetch>[0], key = "k") {
	const fx = fakeFetch(responses);
	const client = createQuotaClient(provider, { fetchImpl: fx.fetch as typeof fetch });
	return { client, fx, key };
}

test("CN sends raw Authorization first; success on first attempt", async () => {
	const { client, fx, key } = makeClient(CN, [{ status: 200, body: OK }]);
	const res = await client.fetchQuota(key);
	assert.equal(res.status, "ok");
	assert.equal(fx.requests.length, 1);
	assert.equal(fx.requests[0].headers.Authorization, key);
	assert.match(fx.requests[0].url, /open\.bigmodel\.cn/);
});

test("global sends Bearer first", async () => {
	const { client, fx, key } = makeClient(GLOBAL, [{ status: 200, body: OK }]);
	await client.fetchQuota(key);
	assert.equal(fx.requests[0].headers.Authorization, `Bearer ${key}`);
	assert.match(fx.requests[0].url, /api\.z\.ai/);
});

test("401 on preferred scheme → one fallback attempt → winner cached", async () => {
	const { client, fx, key } = makeClient(CN, [{ status: 401, body: {} }, { status: 200, body: OK }]);
	const res = await client.fetchQuota(key);
	assert.equal(res.status, "ok");
	assert.equal(fx.requests.length, 2);
	assert.equal(fx.requests[1].headers.Authorization, `Bearer ${key}`);
	await client.fetchQuota(key);
	assert.equal(fx.requests.length, 3);
	assert.equal(fx.requests[2].headers.Authorization, `Bearer ${key}`, "cached scheme reused");
});

test("401 on both schemes → auth error; breaker opens after the second failed call", async () => {
	const { client, fx, key } = makeClient(CN, [{ status: 401, body: {} }]);
	const res = await client.fetchQuota(key);
	assert.equal(res.status, "error");
	assert.ok(res.message.includes(ERR_AUTH));
	assert.equal(fx.requests.length, 2, "both schemes tried in one call");
	const res2 = await client.fetchQuota(key);
	assert.equal(res2.status, "error");
	assert.equal(fx.requests.length, 4, "second failed call");
	const res3 = await client.fetchQuota(key);
	assert.equal(res3.status, "error");
	assert.equal(fx.requests.length, 4, "breaker open: no further requests");
	client.resetBreaker();
	await client.fetchQuota(key);
	assert.equal(fx.requests.length, 6, "after reset, both schemes tried again");
});

test("429 honors Retry-After seconds: immediate retry suppressed", async () => {
	const { client, fx, key } = makeClient(CN, [
		{ status: 429, body: {}, headers: { "retry-after": "30" } },
	]);
	const res = await client.fetchQuota(key);
	assert.equal(res.status, "retry");
	assert.equal(res.retryAfterMs, 30_000);
	assert.equal(fx.requests.length, 1, "no immediate retry");
});

test("malformed JSON → fixed parse error string, never the response body", async () => {
	const raw = "{not the real body";
	const fn = (async () => new Response(raw, { status: 200 })) as unknown as typeof fetch;
	const client = createQuotaClient(CN, { fetchImpl: fn });
	const res = await client.fetchQuota("k");
	assert.equal(res.status, "error");
	assert.equal(res.message, ERR_PARSE);
	assert.ok(!res.message?.includes(raw));
});

test("timeout aborts → fixed error string", async () => {
	const slow = ((url: string | URL, init?: RequestInit) =>
		new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
		})) as unknown as typeof fetch;
	const client = createQuotaClient(CN, { fetchImpl: slow, timeoutMs: 20 });
	const res = await client.fetchQuota("k");
	assert.equal(res.status, "error");
	assert.ok(res.message?.includes("timed out"));
});
