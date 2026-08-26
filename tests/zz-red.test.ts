import assert from "node:assert/strict";
import { test } from "node:test";

test("deliberate failure to verify CI reports red", () => {
	assert.equal(1, 2);
});
