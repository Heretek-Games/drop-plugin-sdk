import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  validateManifest,
  initPlugin,
  buildPlugin,
  startDevServer,
} from "../dist/index.js";

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "drop-cli-feature-test-"));
}

test("validateManifest accepts new capabilities and settingsSchema", async () => {
  const manifest = {
    id: "extended-plugin",
    name: "Extended Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["server", "client"],
    server: {
      entry: "dist/server.js",
      capabilities: ["auth:provider", "storage:depot"],
    },
    client: {
      entry: "dist/client.js",
      capabilities: ["game:runner"],
    },
    settingsSchema: {
      fields: [
        {
          key: "apiKey",
          label: "API Key",
          type: "password",
          required: true,
        },
        {
          key: "enabled",
          label: "Enabled",
          type: "boolean",
          default: true,
        },
        {
          key: "runnerMode",
          label: "Runner Mode",
          type: "select",
          options: [
            { label: "Proton", value: "proton" },
            { label: "Wine", value: "wine" },
          ],
        },
      ],
    },
  };

  const res = await validateManifest(manifest);
  assert.equal(res.valid, true, `Validation errors: ${res.errors.join(", ")}`);
});

test("initPlugin scaffolds various templates correctly", async () => {
  const tmp = await makeTempDir();

  // Test client-ui template
  const uiDir = path.join(tmp, "ui-plugin");
  const uiRes = await initPlugin(uiDir, {
    template: "client-ui",
    id: "custom-ui",
    name: "Custom UI Plugin",
  });
  assert.equal(uiRes.id, "custom-ui");
  const uiManifest = JSON.parse(
    await fs.readFile(path.join(uiDir, "drop-plugin.json"), "utf-8"),
  );
  assert.equal(uiManifest.id, "custom-ui");
  assert.equal(uiManifest.name, "Custom UI Plugin");
  assert.ok(
    await fs.stat(path.join(uiDir, "src/components/MyPanel.vue")).catch(() => null),
  );

  // Test metadata template
  const metaDir = path.join(tmp, "meta-plugin");
  const metaRes = await initPlugin(metaDir, {
    template: "metadata",
    id: "custom-meta",
  });
  assert.equal(metaRes.id, "custom-meta");
  const metaManifest = JSON.parse(
    await fs.readFile(path.join(metaDir, "drop-plugin.json"), "utf-8"),
  );
  assert.ok(metaManifest.server.capabilities.includes("metadata:provider"));

  // Test store template
  const storeDir = path.join(tmp, "store-plugin");
  const storeRes = await initPlugin(storeDir, {
    template: "store",
    id: "custom-store",
  });
  assert.equal(storeRes.id, "custom-store");
  const storeManifest = JSON.parse(
    await fs.readFile(path.join(storeDir, "drop-plugin.json"), "utf-8"),
  );
  assert.ok(storeManifest.client.capabilities.includes("client:library-scan"));

  // Test runner template
  const runnerDir = path.join(tmp, "runner-plugin");
  const runnerRes = await initPlugin(runnerDir, {
    template: "runner",
    id: "custom-runner",
  });
  assert.equal(runnerRes.id, "custom-runner");
  const runnerManifest = JSON.parse(
    await fs.readFile(path.join(runnerDir, "drop-plugin.json"), "utf-8"),
  );
  assert.ok(runnerManifest.client.capabilities.includes("game:runner"));

  // Test fullstack template
  const fullDir = path.join(tmp, "full-plugin");
  const fullRes = await initPlugin(fullDir, {
    template: "fullstack",
    id: "custom-full",
  });
  assert.equal(fullRes.id, "custom-full");
  const fullManifest = JSON.parse(
    await fs.readFile(path.join(fullDir, "drop-plugin.json"), "utf-8"),
  );
  assert.ok(fullManifest.targets.includes("server"));
  assert.ok(fullManifest.targets.includes("client"));
  assert.equal(fullManifest.settingsSchema.fields.length, 4);
  assert.ok(
    await fs
      .stat(path.join(fullDir, "src/components/StatusPanel.vue"))
      .catch(() => null),
  );

  // Every template ships the publishing pipeline, scope switch, typecheck
  // script, and concrete (non-workspace) SDK dependencies.
  for (const [dir, template] of [
    [uiDir, "client-ui"],
    [metaDir, "metadata"],
    [storeDir, "store"],
    [runnerDir, "runner"],
    [fullDir, "fullstack"],
  ] as const) {
    for (const rel of [
      ".github/workflows/release.yml",
      ".github/workflows/ci.yml",
      ".sdk-scope.json",
      "scripts/switch-sdk-scope.mjs",
    ]) {
      assert.ok(
        await fs.stat(path.join(dir, rel)).catch(() => null),
        `${template} is missing ${rel}`,
      );
    }
    const pkg = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf-8"),
    );
    assert.ok(pkg.scripts.typecheck, `${template} is missing a typecheck script`);
    assert.equal(pkg.dependencies["@droposs/plugin-sdk"], "^0.7.0");
    assert.equal(pkg.devDependencies["@droposs/plugin-cli"], "^0.7.0");
    assert.equal(pkg.dependencies["@drop-oss/plugin-sdk"], undefined);
    assert.equal(pkg.devDependencies["@drop-oss/plugin-cli"], undefined);
  }

  const runnerSrc = await fs.readFile(
    path.join(runnerDir, "src/client.ts"),
    "utf-8",
  );
  assert.match(runnerSrc, /@droposs\/plugin-sdk/);
  assert.doesNotMatch(runnerSrc, /@drop-oss\/plugin-sdk/);

  await fs.rm(tmp, { recursive: true, force: true });
});

test("buildPlugin compiles Vue 3 SFC and extracts CSS", async () => {
  const tmp = await makeTempDir();
  const manifest = {
    id: "vue-test-plugin",
    name: "Vue Test Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client"],
    client: {
      entry: "dist/client.js",
      capabilities: ["ui:slot"],
    },
  };

  await fs.writeFile(
    path.join(tmp, "drop-plugin.json"),
    JSON.stringify(manifest, null, 2),
  );
  await fs.mkdir(path.join(tmp, "src"), { recursive: true });

  const sfcCode = `<template>
  <div class="test-sfc-card">
    <span class="greeting">{{ greeting }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
const greeting = ref("Hello from Vue SFC!");
</script>

<style scoped>
.test-sfc-card {
  padding: 16px;
  background: #111;
}
.greeting {
  color: #42b883;
}
</style>
`;
  await fs.writeFile(path.join(tmp, "src/MyCard.vue"), sfcCode, "utf-8");

  const clientTs = `import MyCard from "./MyCard.vue";
import type { ClientPlugin, ClientPluginContext } from "@drop-oss/plugin-sdk";

export default class TestPlugin implements ClientPlugin {
  metadata = {
    id: "vue-test-plugin",
    name: "Vue Test Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: ["ui:slot" as const],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.registerSlot("game-details:tab", MyCard);
  }
}
`;
  await fs.writeFile(path.join(tmp, "src/client.ts"), clientTs, "utf-8");

  const buildResult = await buildPlugin(tmp);
  assert.equal(buildResult.clientBuilt, true);

  const clientJs = await fs.readFile(path.join(tmp, "dist/client.js"), "utf-8");
  assert.ok(
    clientJs.includes("Hello from Vue SFC!"),
    "Expected compiled template text in JS bundle",
  );
  assert.ok(
    clientJs.includes("globalThis.Vue"),
    "Expected globalThis.Vue shim in JS bundle",
  );

  const clientCss = await fs.readFile(path.join(tmp, "dist/client.css"), "utf-8");
  assert.ok(
    clientCss.includes(".test-sfc-card"),
    "Expected CSS rule in extracted client.css",
  );

  const updatedManifest = JSON.parse(
    await fs.readFile(path.join(tmp, "drop-plugin.json"), "utf-8"),
  );
  assert.equal(updatedManifest.client.css, "dist/client.css");

  await fs.rm(tmp, { recursive: true, force: true });
});

test("startDevServer serves manifest and assets with CORS headers", async () => {
  const tmp = await makeTempDir();
  const manifest = {
    id: "dev-server-plugin",
    name: "Dev Server Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client"],
    client: {
      entry: "dist/client.js",
      capabilities: ["ui:slot"],
    },
  };

  await fs.writeFile(
    path.join(tmp, "drop-plugin.json"),
    JSON.stringify(manifest, null, 2),
  );
  await fs.mkdir(path.join(tmp, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, "src/client.ts"),
    "console.log('dev build');",
    "utf-8",
  );

  // Set port to 0 for ephemeral port assignment
  const server = await startDevServer(tmp, { port: 0 });
  assert.ok(server.port > 0);

  try {
    // Fetch manifest
    const manifestRes = await fetch(server.manifestUrl);
    assert.equal(manifestRes.status, 200);
    assert.equal(
      manifestRes.headers.get("access-control-allow-origin"),
      "*",
    );
    const servedManifest = await manifestRes.json();
    assert.equal(servedManifest.id, "dev-server-plugin");

    // Fetch client.js
    const jsRes = await fetch(`${server.url}/dist/client.js`);
    assert.equal(jsRes.status, 200);
    assert.equal(jsRes.headers.get("access-control-allow-origin"), "*");
    const jsContent = await jsRes.text();
    assert.ok(jsContent.includes("dev build"));

    // Test 404
    const notFoundRes = await fetch(`${server.url}/nonexistent.js`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    await server.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
