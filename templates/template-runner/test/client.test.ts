import test from "node:test";
import assert from "node:assert/strict";
import { MockClientPluginContext } from "@drop-oss/plugin-sdk";
import MyRunnerPlugin from "../dist/src/client.js";

test("MyRunnerPlugin registers runner provider and resolves launch", async () => {
  const ctx = new MockClientPluginContext("my-runner-plugin", [
    "game:runner",
    "system:command",
    "client:storage",
  ]);
  const plugin = new MyRunnerPlugin();

  await plugin.init(ctx);

  assert.equal(ctx.runnerProviders.length, 1);
  const runner = ctx.runnerProviders[0];
  assert.equal(runner?.id, "example-runner");

  const detectResult = await runner.detect();
  assert.equal(detectResult.available, true);
  assert.equal(detectResult.version, "1.0.0");

  const overrides = await runner.resolveLaunch({
    gameId: "game-123",
    gameTitle: "Example Game",
    gameDir: "/games/game-123",
  });

  assert.equal(overrides.wrapperBin, "example-runner");
  assert.deepEqual(overrides.wrapperArgs, ["--game", "game-123"]);
  assert.equal(overrides.environment?.RUNNER_DEBUG, "1");
});
