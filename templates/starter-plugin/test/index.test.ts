import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@drop-oss/plugin-sdk";
import StarterPlugin from "../src/index.js";

test("StarterPlugin registers /ping route and updates storage", async () => {
  const ctx = new MockPluginContext("starter-plugin", [
    "routes",
    "storage",
    "events",
  ]);
  const plugin = new StarterPlugin();

  await plugin.init(ctx);

  assert.ok(ctx.routes.has("GET /ping"));
  const route = ctx.routes.get("GET /ping");
  assert.ok(route);

  const res = (await route.handler(null, { params: {}, query: {} })) as {
    status: string;
    time: number;
  };
  assert.equal(res.status, "ok");

  const runCount = await ctx.storage.get("run_count");
  assert.equal(runCount, 1);
});
