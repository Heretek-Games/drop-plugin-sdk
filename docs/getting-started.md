# Getting Started with Drop Plugins

Welcome to the Drop Plugin Developer Guide. This guide walks you through creating, testing, building, and deploying an extension for the [Drop](https://github.com/Drop-OSS/drop) game distribution platform using the official `@drop-oss/plugin-sdk` toolchain.

---

## Prerequisites

- **Node.js**: v22.0.0 or later
- **Package Manager**: `pnpm`, `npm`, or `yarn`
- **Drop**: Drop server v0.4.0+ or Drop Desktop client

---

## 1. Scaffolding a New Plugin

Use the Drop Plugin CLI (`@drop-oss/plugin-cli`) to scaffold a complete plugin repository with TypeScript, build configuration, schema validation, and unit tests:

```bash
# Scaffold a new plugin named "my-plugin"
npx @drop-oss/plugin-cli init my-plugin

cd my-plugin
pnpm install
```

### Directory Structure

```
my-plugin/
├── drop-plugin.json       # Plugin manifest (metadata, capabilities, entry points)
├── package.json           # Node package dependencies
├── tsconfig.json          # TypeScript compiler configuration
├── src/
│   ├── index.ts           # Server-side entry point (implements ServerPlugin)
│   └── client.ts          # Desktop client-side entry point (implements ClientPlugin)
└── test/
    └── index.test.ts      # Unit tests using MockPluginContext & MockClientPluginContext
```

---

## 2. Implementing Server Logic

Server plugins run within Drop's Nitro / Node.js runtime. They can register HTTP routes, maintain isolated persistent storage, broadcast events, and establish real-time WebSocket channels.

In `src/index.ts`:

```typescript
import type { PluginContext, ServerPlugin } from "@drop-oss/plugin-sdk";

export default class MyPlugin implements ServerPlugin {
  metadata = {
    id: "my-plugin",
    name: "My First Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["server" as const],
    capabilities: ["routes" as const, "storage" as const, "websocket" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info("Initializing MyPlugin on Drop server...");

    // Register a custom REST route under /api/v1/plugins/my-plugin/status
    ctx.registerRoute("GET", "/status", async () => {
      const launches = (await ctx.storage.get<number>("launch_count")) ?? 0;
      return { status: "online", launches };
    });

    // Register a real-time WebSocket channel
    ctx.registerWebSocket("my-plugin:events", (msg, wsCtx) => {
      ctx.logger.info(`Received WS message: ${JSON.stringify(msg)}`);
      wsCtx.send({ ack: true, timestamp: Date.now() });
    });
  }

  async teardown(): Promise<void> {
    // Cleanup any background timers or resources
  }
}
```

---

## 3. Implementing Desktop Client Logic

Client plugins run within the Drop Tauri desktop webview. They can inject Vue components into UI slots, contribute dynamic Play Actions, and intercept game launches with fail-closed rollbacks.

In `src/client.ts`:

```typescript
import type {
  ClientPlugin,
  ClientPluginContext,
  LaunchContext,
} from "@drop-oss/plugin-sdk";

export default class MyClientPlugin implements ClientPlugin {
  metadata = {
    id: "my-plugin",
    name: "My First Plugin (Client)",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: [
      "ui:slot" as const,
      "ui:play-action" as const,
      "game:launch-hook" as const,
    ],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.logger.info("Initializing MyClientPlugin on desktop client...");

    // 1. Inject a panel into the game details page
    ctx.registerSlot(
      "game-detail:panels",
      {
        // Use a render function: production builds ship no Vue runtime
        // template compiler, so raw `template:` strings are rejected.
        render() {
          const h = (globalThis as Record<string, any>).window?.Vue?.h;
          return h(
            "div",
            {
              class:
                "rounded-lg border border-purple-500/30 bg-purple-500/10 p-4 text-xs text-purple-200",
            },
            [
              h("p", { class: "font-semibold" }, "My Custom Plugin Panel"),
              h(
                "p",
                { class: "text-zinc-400 mt-1" },
                "Enhancing your game library experience.",
              ),
            ],
          );
        },
      },
      { label: "My Plugin", order: 5 },
    );

    // 2. Add an alternative Play Action in the Play button dropdown
    ctx.registerPlayAction((gameId: string) => [
      {
        id: "play-special",
        name: "Play (Custom Mode)",
        isDefault: false,
        execute: async (context: LaunchContext) => {
          ctx.logger.info(`Launching ${context.gameTitle} in custom mode`);
        },
      },
    ]);

    // 3. Register a pre-launch hook to validate preconditions
    ctx.registerLaunchHook({
      stage: "pre-launch:validate",
      order: 10,
      execute: async (context: LaunchContext) => {
        ctx.logger.info(
          `Validating prerequisites for game ${context.gameId}...`,
        );
      },
    });
  }
}
```

---

## 4. Testing with Mock Harnesses

Drop Plugin SDK provides high-fidelity in-memory mock harnesses (`MockPluginContext` and `MockClientPluginContext`) that enforce capability gating and simulate runtime environments without requiring a running Drop instance.

In `test/index.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MockPluginContext,
  MockClientPluginContext,
} from "@drop-oss/plugin-sdk";
import MyPlugin from "../src/index.js";
import MyClientPlugin from "../src/client.js";

test("MyPlugin server registers route and storage", async () => {
  const ctx = new MockPluginContext("my-plugin", [
    "routes",
    "storage",
    "websocket",
  ]);
  const plugin = new MyPlugin();
  await plugin.init(ctx);

  assert.equal(ctx.routes.has("GET /status"), true);
  const handler = ctx.routes.get("GET /status")!;
  const response = (await handler({} as any, { params: {}, query: {} })) as any;
  assert.equal(response.status, "online");
});

test("MyClientPlugin registers UI slots and play actions", async () => {
  const ctx = new MockClientPluginContext("my-plugin", [
    "ui:slot",
    "ui:play-action",
    "game:launch-hook",
  ]);
  const plugin = new MyClientPlugin();
  await plugin.init(ctx);

  assert.equal(ctx.registeredSlots.get("game-detail:panels")?.length, 1);
  assert.equal(ctx.playActionProviders.length, 1);
});
```

Run tests using the CLI:

```bash
npx drop-plugin test .
```

---

## 5. Building, Validating & Packaging

### Step A: Build

Bundle your TypeScript source into optimized, standalone ESM bundles:

```bash
npx drop-plugin build .
```

This produces the entry points declared in `drop-plugin.json` (`server.entry` / `client.entry`, e.g. `dist/src/index.js` and `dist/src/client.js`) and writes the SHA-256 digests into `drop-plugin.json`. Pass `--out-manifest <path>` to keep the derived digests out of the source manifest.

### Step B: Validate

Validate the manifest against the official JSON Schema:

```bash
npx drop-plugin validate .
```

### Step C: Sign (Optional for trusted deployments)

Calculate HMAC-SHA256 signature if an administrator key is configured:

```bash
export DROP_PLUGIN_SIGNING_KEY="your-signing-secret"
npx drop-plugin sign .
```

### Step D: Package

Package the bundle into a distributable `.dropplugin` archive:

```bash
npx drop-plugin pack . ./dist-package
```

This generates `dist-package/my-plugin-1.0.0.dropplugin`.

---

## 6. Installing into Drop

### Via Web Admin Settings

1. Log in as an administrator on your Drop server.
2. Navigate to **Admin Settings → Plugins**.
3. Under **Install Plugin Bundle**, upload your `.dropplugin` file or enter its download URL.
4. Click **Install**. The plugin initializes dynamically without server restart.

### Via Desktop Settings

1. Open Drop Desktop.
2. Go to **Settings → Plugins & Extensions**.
3. Click **Upload .dropplugin / JSON** to select your package.
