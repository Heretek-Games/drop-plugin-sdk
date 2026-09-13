# drop-plugin-sdk

Extensibility platform and development SDK for the [Drop](https://github.com/Heretek-Games/drop) game distribution platform.

Maintained by [Heretek Games](https://github.com/Heretek-Games/drop-plugin-sdk).

## Packages

| Package | Role |
| :--- | :--- |
| **`@droposs/plugin-sdk`** (`packages/plugin-sdk`) | Core contract types (`PluginMetadata`, `PluginManifest`, `PluginContext`, `ClientPluginContext`, `ServerPlugin`, `ClientPlugin`) and testing harnesses (`MockPluginContext`, `MockClientPluginContext`). |
| **`@droposs/plugin-cli`** (`packages/plugin-cli`) | Command line tool (`drop-plugin`) to build, test, package (`.dropplugin`), and cryptographically sign plugin bundles. |
| **`templates/starter-plugin`** | Ready-to-use template repository for creating new Drop plugins (server + client). |

## Quick Start

### 1. Install SDK in your plugin project
```bash
npm install @droposs/plugin-sdk
```

### 2. Implement a Plugin
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

### 3. Sign & Package the Bundle
```bash
# Signs drop-plugin.json with SHA-256 digests and optional HMAC signature
npx drop-plugin sign .

# Packages verified bundle into a .dropplugin archive for distribution
npx drop-plugin pack .
```
