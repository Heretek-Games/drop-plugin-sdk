import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  signPlugin,
  packPlugin,
  validateManifest,
  buildPlugin,
  initPlugin,
  verifyPlugin,
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

test("signature covers the manifest so id/version/capability tampering is detected", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-test-"));
  const key = "test-signing-key";
  try {
    const manifest = {
      id: "verify-test",
      name: "Verify Test",
      version: "1.0.0",
      apiVersion: 2,
      targets: ["server"],
      capabilities: ["routes"],
      server: { entry: "index.js", capabilities: ["routes"] },
    };
    await fs.writeFile(
      path.join(tmpDir, "drop-plugin.json"),
      JSON.stringify(manifest),
      "utf-8",
    );
    await fs.writeFile(path.join(tmpDir, "index.js"), "export {};", "utf-8");

    await signPlugin(tmpDir, key);

    const ok = await verifyPlugin(tmpDir, key);
    assert.equal(ok.valid, true, ok.errors.join("; "));
    assert.equal(ok.signed, true);

    // Tamper with a manifest field the old signature did not cover.
    const tampered = JSON.parse(
      await fs.readFile(path.join(tmpDir, "drop-plugin.json"), "utf-8"),
    );
    tampered.capabilities = ["routes", "network"];
    await fs.writeFile(
      path.join(tmpDir, "drop-plugin.json"),
      JSON.stringify(tampered),
      "utf-8",
    );
    const tamperedResult = await verifyPlugin(tmpDir, key);
    assert.equal(tamperedResult.valid, false);
    assert.ok(
      tamperedResult.errors.some((e) =>
        /signature verification failed/.test(e),
      ),
      tamperedResult.errors.join("; "),
    );

    // Tamper with a bundle file.
    await fs.writeFile(
      path.join(tmpDir, "index.js"),
      "export const x = 1;",
      "utf-8",
    );
    const fileResult = await verifyPlugin(tmpDir, key);
    assert.equal(fileResult.valid, false);
    assert.ok(fileResult.errors.some((e) => /checksum mismatch/.test(e)));

    // Without the key, a signed manifest cannot be verified.
    const noKey = await verifyPlugin(tmpDir);
    assert.equal(noKey.valid, false);
    assert.ok(noKey.errors.some((e) => /no signing key/.test(e)));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verifyPlugin rejects unsigned bundles unless --allow-unsigned is requested", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-unsigned-"));
  try {
    await fs.writeFile(
      path.join(tmpDir, "drop-plugin.json"),
      JSON.stringify({
        id: "unsigned",
        name: "Unsigned",
        version: "1.0.0",
        apiVersion: 2,
        targets: ["server"],
        capabilities: ["routes"],
        server: { entry: "index.js", capabilities: ["routes"] },
      }),
      "utf-8",
    );
    await fs.writeFile(path.join(tmpDir, "index.js"), "export {};", "utf-8");
    await signPlugin(tmpDir);

    const res = await verifyPlugin(tmpDir);
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.some((e) => /unsigned/.test(e)),
      res.errors.join("; "),
    );

    const allowed = await verifyPlugin(tmpDir, undefined, {
      allowUnsigned: true,
    });
    assert.equal(allowed.valid, true, allowed.errors.join("; "));
    assert.equal(allowed.signed, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verifyPlugin still accepts legacy files-only signatures", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-legacy-"));
  const key = "legacy-test-key";
  try {
    const content = "export {};";
    await fs.writeFile(path.join(tmpDir, "index.js"), content, "utf-8");
    const entryDigest = createHash("sha256").update(content).digest("hex");
    const aggregate = createHash("sha256");
    aggregate.update("index.js");
    aggregate.update("\0");
    aggregate.update(String(Buffer.byteLength(content)));
    aggregate.update("\0");
    aggregate.update(Buffer.from(content));
    const legacySignature = createHmac("sha256", key)
      .update(aggregate.digest("hex"))
      .digest("hex");

    await fs.writeFile(
      path.join(tmpDir, "drop-plugin.json"),
      JSON.stringify({
        id: "legacy",
        name: "Legacy",
        version: "1.0.0",
        apiVersion: 2,
        targets: ["server"],
        capabilities: ["routes"],
        server: { entry: "index.js", capabilities: ["routes"] },
        checksum: entryDigest,
        files: { "index.js": entryDigest },
        signature: legacySignature,
      }),
      "utf-8",
    );

    const res = await verifyPlugin(tmpDir, key);
    assert.equal(res.valid, true, res.errors.join("; "));
    assert.equal(res.signed, true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("v2 signature matches the cross-repo fixture vector", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-fixture-"));
  const key = "fixture-signing-key";
  try {
    await fs.mkdir(path.join(tmpDir, "lib"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "index.js"), 'console.log("hi");\n');
    await fs.writeFile(path.join(tmpDir, "lib/a.js"), "export const a = 1;\n");
    await fs.writeFile(
      path.join(tmpDir, "drop-plugin.json"),
      JSON.stringify({
        id: "fixture",
        name: "Fixture",
        version: "1.0.0",
        apiVersion: 2,
        entry: "index.js",
        capabilities: ["events"],
      }),
      "utf-8",
    );

    await signPlugin(tmpDir, key);
    const signed = JSON.parse(
      await fs.readFile(path.join(tmpDir, "drop-plugin.json"), "utf-8"),
    );
    assert.equal(signed.signatureVersion, 2);
    assert.equal(
      signed.files["index.js"],
      "2bf8b125d15a71b5fa79fe710cae0db911a71e65891e270bca1d4eb5dd785288",
    );
    assert.equal(
      signed.files["lib/a.js"],
      "037ecd1db38c230c248787e60fd7bfc0cb0101b187b59535b6e7483be762d350",
    );
    assert.equal(
      signed.signature,
      "3f21422b93a9ca2f852cf9351b628a6c80a7a505b4989dfb72ab80ed88875a96",
    );

    const res = await verifyPlugin(tmpDir, key);
    assert.equal(res.valid, true, res.errors.join("; "));
    assert.equal(res.signed, true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("schema accepts cloudsave:provider in server and client capabilities", async () => {
  const manifest = {
    id: "cloudsave-v2",
    name: "Cloud Save v2",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["server", "client"],
    server: {
      entry: "index.js",
      capabilities: ["routes", "cloudsave:provider"],
    },
    client: {
      entry: "client.js",
      capabilities: ["ui:slot", "cloudsave:provider"],
    },
  };
  const res = await validateManifest(manifest);
  assert.equal(res.valid, true, res.errors.join("; "));
});

async function writeFixtureBundle(
  prefix: string,
  id: string,
  name: string,
): Promise<{ tmpDir: string; manifestPath: string; before: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.writeFile(
    path.join(tmpDir, "drop-plugin.json"),
    JSON.stringify({
      id,
      name,
      version: "1.0.0",
      apiVersion: 2,
      targets: ["server"],
      server: { entry: "index.js", capabilities: ["routes"] },
    }),
    "utf-8",
  );
  await fs.writeFile(path.join(tmpDir, "index.js"), "export {};", "utf-8");
  const manifestPath = path.join(tmpDir, "drop-plugin.json");
  const before = await fs.readFile(manifestPath, "utf-8");
  return { tmpDir, manifestPath, before };
}

test("signPlugin --out-manifest leaves the source manifest untouched", async () => {
  const key = "out-manifest-key";
  const { tmpDir, manifestPath, before } = await writeFixtureBundle(
    "sign-out-",
    "out-manifest",
    "Out Manifest",
  );
  try {
    const outPath = path.join(tmpDir, "derived", "drop-plugin.json");
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const res = await signPlugin(tmpDir, key, true, { outManifest: outPath });
    assert.equal(res.signed, true);
    assert.equal(await fs.readFile(manifestPath, "utf-8"), before);

    const derived = JSON.parse(await fs.readFile(outPath, "utf-8"));
    assert.equal(derived.signatureVersion, 2);
    assert.ok(derived.signature);
    assert.ok(derived.files["index.js"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("packPlugin leaves the source manifest untouched", async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pack-out-"));
  const key = "pack-clean-key";
  const previousKey = process.env.DROP_PLUGIN_SIGNING_KEY;
  process.env.DROP_PLUGIN_SIGNING_KEY = key;
  const { tmpDir, manifestPath, before } = await writeFixtureBundle(
    "pack-clean-",
    "pack-clean",
    "Pack Clean",
  );
  try {
    const res = await packPlugin(tmpDir, outDir);
    assert.equal(await fs.readFile(manifestPath, "utf-8"), before);

    const archive = JSON.parse(await fs.readFile(res.packagePath, "utf-8"));
    assert.equal(archive.manifest.signatureVersion, 2);
    assert.ok(archive.manifest.signature);
    assert.ok(archive.manifest.files["index.js"]);
  } finally {
    if (previousKey === undefined) {
      delete process.env.DROP_PLUGIN_SIGNING_KEY;
    } else {
      process.env.DROP_PLUGIN_SIGNING_KEY = previousKey;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
