import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { signPlugin, packPlugin } from "../dist/signer.js";

test("signPlugin computes digests and packPlugin creates .dropplugin", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-test-"));
  try {
    const manifest = {
      id: "cli-test-plugin",
      name: "CLI Test Plugin",
      version: "1.0.0",
      apiVersion: 2,
      targets: ["client"],
      client: {
        entry: "index.js",
        capabilities: ["ui:slot"],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, "drop-plugin.json"),
      JSON.stringify(manifest),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmpDir, "index.js"),
      "console.log('client entry');",
      "utf-8",
    );

    // Test sign
    const signRes = await signPlugin(tmpDir);
    assert.equal(signRes.fileCount, 1);
    assert.equal(signRes.signed, false);

    const signedManifest = JSON.parse(
      await fs.readFile(path.join(tmpDir, "drop-plugin.json"), "utf-8"),
    );
    assert.ok(signedManifest.checksum);
    assert.ok(signedManifest.files["index.js"]);

    // Test pack
    const outDir = path.join(tmpDir, "out");
    const packRes = await packPlugin(tmpDir, outDir);
    assert.equal(packRes.id, "cli-test-plugin");
    assert.equal(packRes.version, "1.0.0");
    assert.ok(packRes.packagePath.endsWith("cli-test-plugin-1.0.0.dropplugin"));

    const packageContent = JSON.parse(
      await fs.readFile(packRes.packagePath, "utf-8"),
    );
    assert.equal(packageContent.format, "dropplugin-v2");
    assert.ok(packageContent.files["index.js"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
