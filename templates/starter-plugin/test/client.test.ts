import test from "node:test";
import assert from "node:assert/strict";
import { MockClientPluginContext } from "@drop-oss/plugin-sdk";
import StarterClientPlugin from "../src/client.js";

test("StarterClientPlugin registers play action, launch hook, and updates storage", async () => {
  const ctx = new MockClientPluginContext("starter-plugin", [
    "ui:slot",
    "ui:play-action",
    "game:launch-hook",
    "client:storage",
  ]);
  const plugin = new StarterClientPlugin();

  await plugin.init(ctx);

  // Verify UI slot registration
  const panels = ctx.registeredSlots.get("game-detail:panels");
  assert.equal(panels?.length, 1);
  assert.equal(panels[0].label, "Starter Status");

  // Verify play action provider registration
  assert.equal(ctx.playActionProviders.length, 1);
  const actions = await ctx.playActionProviders[0]("game-1");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, "starter-quick-launch");
  assert.equal(actions[0].name, "Launch with Starter Mode");

  // Verify launch hook registration
  assert.equal(ctx.launchHooks.length, 1);
  assert.equal(ctx.launchHooks[0].stage, "pre-launch:validate");

  // Verify storage
  const isInit = await ctx.storage.get("client_initialized");
  assert.equal(isInit, true);
});
