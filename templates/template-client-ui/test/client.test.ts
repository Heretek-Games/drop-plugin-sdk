import test from "node:test";
import assert from "node:assert/strict";
import * as Vue from "vue";

// Shim globalThis.Vue for the Node.js test environment
(globalThis as unknown as { Vue: typeof Vue }).Vue = Vue;

import { MockClientPluginContext } from "@drop-oss/plugin-sdk";

test("MyClientUiPlugin registers Vue component in game-detail:panels slot", async () => {
  const { default: MyClientUiPlugin } = await import("../dist/src/client.js");
  const ctx = new MockClientPluginContext("my-client-ui-plugin", [
    "ui:slot",
    "client:storage",
  ]);
  const plugin = new MyClientUiPlugin();

  await plugin.init(ctx);

  const panels = ctx.registeredSlots.get("game-detail:panels");
  assert.equal(panels?.length, 1);
  assert.equal(panels[0].label, "Extension Panel");
  assert.equal(await ctx.storage.get("ui_plugin_loaded"), true);
});
