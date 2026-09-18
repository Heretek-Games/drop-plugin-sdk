import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@drop-oss/plugin-sdk";
import MyFullstackPlugin from "../dist/src/index.js";

test("MyFullstackPlugin registers status and config routes", async () => {
  const ctx = new MockPluginContext("my-fullstack-plugin", [
    "routes",
    "storage",
    "network",
    "events",
  ]);
  const plugin = new MyFullstackPlugin();

  await plugin.init(ctx);

  const status = ctx.routes.get("GET /status");
  assert.ok(status);
  const statusRes = (await status.handler(null, {
    params: {},
    query: {},
    readJson: async <T = unknown>() => ({}) as T,
  })) as { ok: boolean };
  assert.equal(statusRes.ok, true);

  const config = ctx.routes.get("POST /config");
  assert.ok(config);
  const configRes = (await config.handler(null, {
    params: {},
    query: {},
    readJson: async <T = unknown>() => ({ mode: "full" }) as T,
  })) as { saved: boolean; synced: number };
  assert.equal(configRes.saved, true);
  assert.equal(configRes.synced, 1);
  assert.deepEqual(await ctx.storage.get("last_config"), { mode: "full" });
});
