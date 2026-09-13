import test from "node:test";
import assert from "node:assert/strict";
import {
  MockPluginContext,
  MockClientPluginContext,
  PLUGIN_API_VERSION,
  type PlayAction,
  type LaunchHook,
} from "../dist/index.js";

test("PLUGIN_API_VERSION is 2", () => {
  assert.equal(PLUGIN_API_VERSION, 2);
});

test("MockPluginContext enforces capability gating", () => {
  const ctx = new MockPluginContext("server-test", ["routes"]);
  ctx.registerRoute("GET", "/test", () => ({ ok: true }));
  assert.ok(ctx.routes.has("GET /test"));

  // Lacks 'websocket' capability
  assert.throws(() => {
    ctx.registerWebSocket("my-channel", () => {});
  }, /missing required capability 'websocket'/);
});

test("MockClientPluginContext registers UI slots and Play Actions", async () => {
  const ctx = new MockClientPluginContext("client-test", [
    "ui:slot",
    "ui:play-action",
    "ui:context-menu",
    "game:launch-hook",
    "game:fs",
    "game:scan",
    "client:storage",
  ]);

  // UI slot
  const dummyComponent = { template: "<div>Hello</div>" };
  ctx.registerSlot("game-detail:actions", dummyComponent, { order: 10 });
  const slots = ctx.registeredSlots.get("game-detail:actions");
  assert.equal(slots?.length, 1);
  assert.equal(slots[0].order, 10);

  // Play Action
  ctx.registerPlayAction((gameId) => [
    {
      id: "action-multiplayer",
      name: "Play Multiplayer Room",
      execute: () => {},
    },
  ]);

  const actions = await ctx.resolvePlayActions("game-123");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].name, "Play Multiplayer Room");

  // Scoped Game FS
  await ctx.gameFs.writeFile("game-123", "config.txt", "port=1234");
  assert.equal(await ctx.gameFs.fileExists("game-123", "config.txt"), true);
  const hash = await ctx.gameFs.backupFile("game-123", "config.txt");
  assert.ok(hash.startsWith("mock-sha256"));

  // Overwrite and restore
  await ctx.gameFs.writeFile("game-123", "config.txt", "mutated");
  const mutated = new TextDecoder().decode(
    await ctx.gameFs.readFile("game-123", "config.txt"),
  );
  assert.equal(mutated, "mutated");

  await ctx.gameFs.restoreFile("game-123", "config.txt");
  const restored = new TextDecoder().decode(
    await ctx.gameFs.readFile("game-123", "config.txt"),
  );
  assert.equal(restored, "port=1234");
});

test("MockClientPluginContext throws on undeclared capability", () => {
  const ctx = new MockClientPluginContext("restricted-plugin", ["ui:slot"]);

  assert.throws(() => {
    ctx.registerPlayAction(() => []);
  }, /missing required capability 'ui:play-action'/);
});
