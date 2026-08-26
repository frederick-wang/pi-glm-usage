import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeFetch } from "./helpers.ts";

/** S2 scaffold smoke: the fetch injector records requests and serves bodies. */
test("fakeFetch records requests and serves queued responses", async () => {
	const fx = fakeFetch([{ status: 200, body: { code: 200, data: { limits: [] } } }]);
	const res = await fx.fetch("https://example.test/quota", { headers: { Authorization: "k" } });
	assert.equal(res.status, 200);
	assert.equal(fx.requests.length, 1);
	assert.equal(fx.requests[0].url, "https://example.test/quota");
	assert.deepEqual(await res.json(), { code: 200, data: { limits: [] } });
});
