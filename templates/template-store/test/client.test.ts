import test from "node:test";
import assert from "node:assert/strict";
import { MockClientPluginContext } from "@drop-oss/plugin-sdk";
import MyStorePlugin from "../dist/src/client.js";

test("MyStorePlugin registers store scanner and scans games", async () => {
  const ctx = new MockClientPluginContext("my-store-plugin", [
    "client:library-scan",
    "client:storage",
    "system:command",
  ]);
  const plugin = new MyStorePlugin();

  await plugin.init(ctx);

  assert.equal(ctx.storeScanners.length, 1);
  const scanner = ctx.storeScanners[0];
  assert.equal(scanner?.id, "example-store");

  const games = await scanner.scan();
  assert.equal(games.length, 1);
  assert.equal(games[0]?.title, "Example Scanned Game");
});
