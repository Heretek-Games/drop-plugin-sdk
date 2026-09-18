import test from "node:test";
import assert from "node:assert/strict";
import * as Vue from "vue";

// Shim globalThis.Vue for the Node.js test environment
(globalThis as unknown as { Vue: typeof Vue }).Vue = Vue;

import { MockClientPluginContext } from "@drop-oss/plugin-sdk";

test("MyFullstackClientPlugin registers the Vue status panel", async () => {
  const { default: MyFullstackClientPlugin } = await import(
    "../dist/src/client.js"
  );
  const ctx = new MockClientPluginContext("my-fullstack-plugin", [
    "ui:slot",
    "client:storage",
  ]);
  const plugin = new MyFullstackClientPlugin();

  await plugin.init(ctx);

  const panels = ctx.registeredSlots.get("game-detail:panels");
  assert.equal(panels?.length, 1);
  assert.equal(await ctx.storage.get("client_initialized"), true);
});
