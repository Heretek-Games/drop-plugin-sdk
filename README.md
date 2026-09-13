# drop-plugin-sdk

Extensibility platform and development SDK for the [Drop](https://github.com/Heretek-Games/drop) game distribution platform.

Maintained by [Heretek Games](https://github.com/Heretek-Games/drop-plugin-sdk).

## Packages

| Package | Role |
| :--- | :--- |
| **`@drop/plugin-sdk`** (`packages/plugin-sdk`) | Core contract types (`PluginMetadata`, `PluginManifest`, `PluginContext`, `ServerPlugin`) and the `MockPluginContext` test harness. |
| **`@drop/plugin-cli`** (`packages/plugin-cli`) | Command line tool (`drop-plugin`) to build, test, and cryptographically sign plugin bundles. |
| **`templates/starter-plugin`** | Ready-to-use template repository for creating new Drop plugins. |

## Quick Start

### 1. Install SDK in your plugin project
```bash
npm install @drop/plugin-sdk
```

### 2. Implement a Plugin
```typescript
import type { PluginContext, ServerPlugin } from "@drop/plugin-sdk";

export default class MyPlugin implements ServerPlugin {
  metadata = {
    id: "my-plugin",
    name: "My First Plugin",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["routes" as const, "storage" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerRoute("GET", "/status", () => ({ ready: true }));
  }
}
```

### 3. Sign the Bundle
```bash
# Signs drop-plugin.json with SHA-256 digests and optional HMAC signature
npx drop-plugin sign .
```
