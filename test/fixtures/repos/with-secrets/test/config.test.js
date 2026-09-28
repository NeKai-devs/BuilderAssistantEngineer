import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

test("reads the token from the environment", () => {
  assert.equal(loadConfig({ API_TOKEN: "t" }).apiToken, "t");
});
