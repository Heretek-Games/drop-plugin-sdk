# drop-plugin-sdk

Extensibility platform, runtime contract, and developer toolchain for the [Drop](https://github.com/Heretek-Games/drop) game distribution platform.

Maintained by [Heretek Games](https://github.com/Heretek-Games/drop-plugin-sdk).

---

## Packages

| Package | Version | Role |
| :--- | :--- | :--- |
| **`@droposs/plugin-sdk`** (`packages/plugin-sdk`) | `0.1.0` | Universal runtime types (`PLUGIN_API_VERSION = 2`), JSON Schema, RPC helper client, and test harnesses (`MockPluginContext`, `MockClientPluginContext`). |
| **`@droposs/plugin-cli`** (`packages/plugin-cli`) | `0.1.0` | Developer CLI (`drop-plugin`) providing scaffolding (`init`), bundling (`build`), validation (`validate`), testing (`test`), signing (`sign`), and packaging (`pack`). |
| **`templates/starter-plugin`** | `1.0.0` | Reference starter template for creating full-stack Drop plugins (server + desktop client). |

---

## Quick Start

### 1. Scaffold a New Plugin
```bash
npx @droposs/plugin-cli init my-plugin
cd my-plugin
npm install
```

### 2. Implement Server and Client Logic

#### Server Entry (`src/index.ts`)
```typescript
import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";

export default class MyPlugin implements ServerPlugin {
  metadata = {
    id: "my-plugin",
    name: "My First Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["server" as const],
    capabilities: ["routes" as const, "storage" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerRoute("GET", "/status", () => ({ ready: true }));
  }
}
```

#### Client Entry (`src/client.ts`)
```typescript
import type { ClientPlugin, ClientPluginContext } from "@droposs/plugin-sdk";

export default class MyClientPlugin implements ClientPlugin {
  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.registerPlayAction((gameId) => [
      {
        id: "custom-play",
        name: "Play with Custom Mod",
        execute: async () => {
          ctx.logger.info(`Launching game ${gameId} with custom mod`);
        },
      },
    ]);
  }
}
```

### 3. Build, Validate & Test
```bash
# Bundles TS source to ESM dist/ using esbuild and updates drop-plugin.json digests
npx drop-plugin build .

# Validates drop-plugin.json against official JSON Schema
npx drop-plugin validate .

# Executes unit tests against MockPluginContext and MockClientPluginContext
npx drop-plugin test .
```

### 4. Sign & Package for Distribution
```bash
# Cryptographically sign drop-plugin.json (uses DROP_PLUGIN_SIGNING_KEY if present)
npx drop-plugin sign .

# Packages bundle into a .dropplugin archive ready for Drop server/desktop installation
npx drop-plugin pack . ./dist-package
```

---

## Architecture & Invariants

- **`PLUGIN_API_VERSION = 2`**: Target API version matching Drop's plugin manager contract.
- **Strict Confinement**: `signer` and `pack` enforce strict filesystem confinement, rejecting directory traversal (`..`) and symlinks escaping the bundle directory.
- **Capability Gating**: All server and client capabilities must be explicitly declared in `drop-plugin.json`. Undeclared API calls throw in runtime and mock harnesses.
- **Zero Runtime Dependencies**: `@droposs/plugin-sdk` contains zero third-party runtime dependencies.

---

## License

MIT © Heretek Games
