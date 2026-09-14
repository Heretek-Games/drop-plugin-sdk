import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  signPlugin,
  packPlugin,
  validateManifest,
  buildPlugin,
  initPlugin,
} from "../dist/index.js";

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

test("signPlugin rejects symlink escape outside bundle directory", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "symlink-test-"));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "outside-test-"));
  try {
    const secretFile = path.join(outsideDir, "secret.txt");
    await fs.writeFile(secretFile, "top-secret", "utf-8");

    const manifest = {
      id: "traversal-test",
      name: "Traversal Test",
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
      "console.log('safe');",
      "utf-8",
    );

    // Create an escaping symlink
    await fs.symlink(secretFile, path.join(tmpDir, "escaped.txt"));

    await assert.rejects(async () => {
      await signPlugin(tmpDir);
    }, /Path traversal or symlink escape detected/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("validateManifest enforces required schema fields", async () => {
  const validManifest = {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.2.3",
    apiVersion: 2,
    targets: ["server"],
    capabilities: ["routes"],
    server: {
      entry: "index.js",
      capabilities: ["routes"],
    },
  };
  const resValid = await validateManifest(validManifest);
  assert.equal(resValid.valid, true);
  assert.equal(resValid.errors.length, 0);

  const invalidManifest = {
    name: "Missing ID and version",
  };
  const resInvalid = await validateManifest(invalidManifest);
  assert.equal(resInvalid.valid, false);
  assert.ok(resInvalid.errors.length > 0);
});

test("buildPlugin bundles TypeScript source files and signs manifest", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "build-test-"));
  try {
    const manifest = {
      id: "builder-test",
      name: "Builder Test",
      version: "1.0.0",
      apiVersion: 2,
      targets: ["server", "client"],
      capabilities: ["routes", "ui:slot"],
      server: {
        entry: "dist/index.js",
        capabilities: ["routes"],
      },
      client: {
        entry: "dist/client.js",
        capabilities: ["ui:slot"],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, "drop-plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "index.ts"),
      "export const serverGreeting: string = 'hello from server';",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "client.ts"),
      "export const clientGreeting: string = 'hello from client';",
      "utf-8",
    );

    const buildRes = await buildPlugin(tmpDir);
    assert.equal(buildRes.serverBuilt, true);
    assert.equal(buildRes.clientBuilt, true);

    const serverCompiled = await fs.readFile(
      path.join(tmpDir, "dist", "index.js"),
      "utf-8",
    );
    assert.ok(serverCompiled.includes("hello from server"));

    const clientCompiled = await fs.readFile(
      path.join(tmpDir, "dist", "client.js"),
      "utf-8",
    );
    assert.ok(clientCompiled.includes("hello from client"));

    // Verify manifest was signed
    const signedManifest = JSON.parse(
      await fs.readFile(path.join(tmpDir, "drop-plugin.json"), "utf-8"),
    );
    assert.ok(signedManifest.checksum);
    assert.ok(signedManifest.files["dist/index.js"]);
    assert.ok(signedManifest.files["dist/client.js"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("initPlugin scaffolds a new plugin repository", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-test-"));
  const targetDir = path.join(tmpDir, "my-custom-plugin");
  try {
    const res = await initPlugin(targetDir, {
      id: "my-custom-plugin",
      name: "My Custom Plugin",
      author: "Test Author",
    });
    assert.equal(res.id, "my-custom-plugin");

    const manifest = JSON.parse(
      await fs.readFile(path.join(targetDir, "drop-plugin.json"), "utf-8"),
    );
    assert.equal(manifest.id, "my-custom-plugin");
    assert.equal(manifest.name, "My Custom Plugin");
    assert.equal(manifest.author, "Test Author");
    assert.equal(manifest.checksum, undefined);

    const pkg = JSON.parse(
      await fs.readFile(path.join(targetDir, "package.json"), "utf-8"),
    );
    assert.equal(pkg.name, "drop-my-custom-plugin");

    const srcExists = await fs.stat(path.join(targetDir, "src", "index.ts"));
    assert.ok(srcExists.isFile());
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
