import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@drop-oss/plugin-sdk";
import MyMetadataPlugin from "../dist/src/index.js";

test("MyMetadataPlugin registers metadata provider and performs search", async () => {
  const ctx = new MockPluginContext("my-metadata-plugin", [
    "metadata:provider",
    "network",
    "storage",
  ]);
  const plugin = new MyMetadataPlugin();

  await plugin.init(ctx);

  const provider = ctx.metadataProviders.get("example-metadata");
  assert.ok(provider);
  assert.equal(provider.name, "Example Metadata Provider");

  const results = await provider.search("Doom");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.title, "Doom");
  assert.equal(results[0]?.provider, "example-metadata");
});
