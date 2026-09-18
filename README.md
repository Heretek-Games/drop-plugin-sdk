# drop-plugin-sdk

Extensibility platform, runtime contract, and developer toolchain for the [Drop](https://github.com/Heretek-Games/drop) game distribution platform.

Maintained by [Heretek Games](https://github.com/Heretek-Games/drop-plugin-sdk).

---

## Packages

| Package                                            | Version | Role                                                                                                                                                                   |
| :------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@drop-oss/plugin-sdk`** (`packages/plugin-sdk`) | `0.6.2` | Universal runtime types (`PLUGIN_API_VERSION = 2`), JSON Schema, RPC helper client, and test harnesses (`MockPluginContext`, `MockClientPluginContext`).               |
| **`@drop-oss/plugin-cli`** (`packages/plugin-cli`) | `0.6.2` | Developer CLI (`drop-plugin`) providing scaffolding (`init`), bundling (`build`), validation (`validate`), testing (`test`), signing (`sign`), and packaging (`pack`). |
| **`templates/starter-plugin`**                     | `1.0.0` | Reference starter template for creating full-stack Drop plugins (server + desktop client).                                                                             |

> **Scope migration:** v0.6.0 moves the packages from `@droposs/*` to the
> `@drop-oss/*` scope. The publish workflow publishes every release to the
> accessible `@droposs/*` scope (`scripts/publish-legacy-scope.mjs`); publishing
> the `@drop-oss/*` scope is a `workflow_dispatch` opt-in that can only run
> once that scope/Trusted Publisher access exists on npmjs.com. Pre-cutover
> plugin repositories keep depending on the `@droposs/plugin-sdk` and
> `@droposs/plugin-cli` names.
>
> **Heretek plugin repos:** each plugin repo carries `.sdk-scope.json` and
> `scripts/switch-sdk-scope.mjs`. The config (`{"sdk": "@droposs" |
> "@drop-oss"}`, plus `sdkVersion`/`cliVersion`) drives every package.json
> dependency and import specifier in the repo. The npm scope cutoff is a
> two-step, reviewable change:
>
> 1. Publish the release (`v*` tag) so both scopes carry the version.
> 2. Flip `.sdk-scope.json` to `"sdk": "@drop-oss"`, then run
>    `node scripts/switch-sdk-scope.mjs` in each plugin repo.
>
> `.github/workflows/release.yml` in every plugin repo builds, validates,
> packs, checksums, and attaches the `.dropplugin` archive to GitHub Releases.

---

## Quick Start

### 1. Scaffold a New Plugin

```bash
npx @drop-oss/plugin-cli init my-plugin
cd my-plugin
npm install
```

### 2. Implement Server and Client Logic

#### Server Entry (`src/index.ts`)

```typescript
import type { PluginContext, ServerPlugin } from "@drop-oss/plugin-sdk";

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
import type { ClientPlugin, ClientPluginContext } from "@drop-oss/plugin-sdk";

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
- **Zero Runtime Dependencies**: `@drop-oss/plugin-sdk` contains zero third-party runtime dependencies.

---

## Documentation & Guides

Comprehensive guides are available in the [`docs/`](./docs) directory:

- [**Getting Started Tutorial**](./docs/getting-started.md): Scaffolding, implementing, testing, and installing your first plugin.
- [**Server Plugins Guide**](./docs/server-plugins.md): HTTP routing, persistent storage, schema migrations, WebSockets, event bus, and network egress.
- [**Client Plugins Guide**](./docs/client-plugins.md): UI slots, Play Actions, context menus, game launch pipeline with reverse rollback, scoped filesystem, and native execution.
- [**Testing Guide**](./docs/testing-plugins.md): Unit testing server and client plugins using `MockPluginContext` and `MockClientPluginContext`.
- [**Manifest Reference (`drop-plugin.json`)**](./docs/manifest-reference.md): Complete schema specification and capabilities reference.
- [**Packaging, Signing & Distribution**](./docs/publishing-and-distribution.md): Cryptographic bundle signing, packaging, and hosting community registries.
- [**Community Ecosystem Patterns**](./docs/community-ecosystem.md): Architectural patterns inspired by Playnite, Stash, and RomM.

---

## License

MIT © Heretek Games
