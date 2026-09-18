# Drop Plugin Manifest Specification (`drop-plugin.json`)

The `drop-plugin.json` manifest declares plugin metadata, execution targets, required capabilities, entry points, and cryptographic digests.

---

## Complete Manifest Schema (v2)

```json
{
  "$schema": "https://droposs.org/schemas/drop-plugin.schema.json",
  "id": "sample-plugin",
  "name": "Sample Extension",
  "version": "1.0.0",
  "description": "Comprehensive reference plugin demonstrating all v2 manifest fields",
  "author": "Drop Community",
  "homepage": "https://github.com/example/sample-plugin",
  "license": "MIT",
  "apiVersion": 2,
  "category": "generic",
  "trust": "trusted",
  "storageVersion": 1,
  "targets": ["server", "client"],
  "capabilities": ["routes", "storage", "websocket", "events", "network"],
  "server": {
    "entry": "dist/server.js",
    "source": "src/server.ts",
    "storageVersion": 1,
    "capabilities": ["routes", "storage", "websocket", "events", "network"]
  },
  "client": {
    "entry": "dist/client.js",
    "source": "src/client.ts",
    "css": "dist/client.css",
    "capabilities": [
      "ui:slot",
      "ui:play-action",
      "ui:context-menu",
      "game:launch-hook",
      "game:fs",
      "game:scan",
      "client:storage",
      "client:ws",
      "system:command"
    ],
    "commands": ["my-helper-tool"],
    "slots": [
      {
        "slot": "game-detail:panels",
        "component": "PanelComponent"
      }
    ]
  },
  "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "files": {
    "dist/server.js": "a1b2c3...",
    "dist/client.js": "d4e5f6...",
    "dist/client.css": "789abc..."
  },
  "signature": "1234567890abcdef..."
}
```

---

## Field Reference

### Core Identification

- **`id`** (`string`, required): Unique identifier matching `^[a-z0-9][a-z0-9._-]*$`, max 64 characters.
- **`name`** (`string`, required): Display title in user interfaces.
- **`version`** (`string`, required): Semver version (e.g. `1.2.0`).
- **`description`** (`string`, optional): Short summary of features.
- **`author`** (`string`, optional): Author name or organization.
- **`homepage`** (`string`, optional): URL to plugin documentation or repository.
- **`license`** (`string`, optional): SPDX license identifier (e.g. `MIT`, `GPL-3.0-or-later`).

### Architecture & Security

- **`apiVersion`** (`integer`, required): Target Drop Plugin API version. Drop core accepts `SUPPORTED_API_VERSIONS` (`[1, 2]`); a manifest that omits it is rejected.
- **`trust`** (`"trusted" | "sandboxed"`, default `"trusted"`): Trust tier. Currently, plugins run in-process as `"trusted"`.
- **`storageVersion`** (`integer`, optional): Integer schema version for persistent storage migrations.
- **`targets`** (`Array<"server" | "client">`, optional): Platforms the plugin provides code for.

### Target Blocks & Native Sidecars

- **`server`** (`object`, optional): Server target definition:
  - `entry` (`string`, required): Relative path to bundled server JavaScript.
  - `source` (`string`, optional): TypeScript/JavaScript source file bundled by `drop-plugin build`.
  - `capabilities` (`Array<ServerCapability>`, optional): Documentation mirror of server capabilities.
  - `storageVersion` (`integer`, optional): Target storage schema version.
- **`client`** (`object`, optional): Desktop client target definition:
  - `entry` (`string`, required): Relative path to bundled client JavaScript.
  - `source` (`string`, optional): TypeScript/JavaScript source file bundled by `drop-plugin build`.
  - `css` (`string`, optional): Optional stylesheet associated with client entry.
  - `capabilities` (`Array<ClientCapability>`, required): Capabilities granted to client runtime.
  - `commands` (`string[]`, optional): Bare binary names permitted for `ctx.system.run`.
  - `slots` (`Array<{ slot, component }>`, optional): Declarative UI slot bindings.
  - `sidecars` (`Array<{ name, targets }>`, optional): Bundled platform binaries staged by the desktop host. Each target specifies `os` (`"linux" | "macos" | "windows"`), `arch` (`"x64" | "arm64"`), bundle-relative `path`, and SHA-256 `sha256`. The `name` must also be listed in `commands`.

### Declarative Settings (`settingsSchema`)

- **`settingsSchema`** (`object`, optional): Declares typed configuration fields that host UIs render automatically, so plugins no longer need bespoke settings routes/components.
  - `fields` (`Array`, required): Ordered list of field descriptors.
    - `key` (`string`, required): Stable setting key.
    - `label` (`string`, required): Human-readable label.
    - `type` (`"string" | "password" | "number" | "boolean" | "select"`, required): Field control type.
    - `description` (`string`, optional): Helper text.
    - `default` (any, optional): Default value.
    - `options` (`Array<{ label, value }>`, optional): Choices for `select` fields.
    - `required` (`boolean`, optional): Whether the field must be set.

```json
{
  "settingsSchema": {
    "fields": [
      {
        "key": "apiKey",
        "label": "API Key",
        "type": "password",
        "required": true
      },
      {
        "key": "enabled",
        "label": "Enable sync",
        "type": "boolean",
        "default": true
      }
    ]
  }
}
```

---

## Capability Scoping

Capabilities are resolved **per target**, and the two targets do not read the same
place:

- **Server plugins** are granted only the **top-level `capabilities` array**.
  Drop's `PluginManager` builds the server context from `metadata.capabilities`
  and ignores `server.capabilities` entirely, so declaring a server capability
  inside the `server` block grants nothing and fails closed at init.
- **Client plugins** are granted `client.capabilities` when that array is
  present — even an empty one — otherwise they fall back to the top-level
  `capabilities` array. `client.capabilities` and the top-level list are never
  unioned.

For a full-stack plugin, list server capabilities at the top level (and
optionally repeat them under `server.capabilities` for documentation) and list
the client set under `client.capabilities`:

```json
{
  "capabilities": ["routes", "storage", "events"],
  "server": {
    "entry": "dist/server.js",
    "capabilities": ["routes", "storage", "events"]
  },
  "client": {
    "entry": "dist/client.js",
    "capabilities": ["ui:slot", "ui:play-action", "client:storage"]
  }
}
```

The SDK's `getManifestCapabilities`, `compareCapabilities`, and
`assertManifestSupports` helpers mirror this resolution so plugin test suites can
assert that the shipped manifest grants exactly what the code requires.

---

## Capabilities Reference

Capabilities are **strictly fail-closed**. If an API is called without the corresponding capability declared in the target's capability list (see [Capability Scoping](#capability-scoping)), Drop rejects the operation immediately.

### Server Capabilities

| Capability           | Permitted Operations                                                   |
| :------------------- | :--------------------------------------------------------------------- |
| `routes`             | Registering HTTP routes via `ctx.registerRoute`                        |
| `storage`            | Persistent KV access via `ctx.storage` and migrations                  |
| `websocket`          | Claiming channels via `ctx.registerWebSocket` and authorizers          |
| `events`             | Emitting and listening to server events via `broadcast` / `subscribe`  |
| `network`            | External HTTP egress via `ctx.fetch`                                   |
| `metadata:provider`  | Registering metadata providers via `ctx.registerMetadataProvider`      |
| `commerce:payment`   | Registering payment gateways via `ctx.registerPaymentGateway`          |
| `cloudsave:provider` | Registering cloud save resolvers via `ctx.registerCloudSaveResolver`   |
| `auth:provider`      | Registering external auth/SSO providers via `ctx.registerAuthProvider` |
| `storage:depot`      | Registering remote depot providers via `ctx.registerDepotProvider`     |

### Client Capabilities

| Capability            | Permitted Operations                                                         |
| :-------------------- | :--------------------------------------------------------------------------- |
| `ui:slot`             | Injecting Vue components into UI slots via `ctx.registerSlot`                |
| `ui:play-action`      | Dynamic alternative game startup modes via `ctx.registerPlayAction`          |
| `ui:context-menu`     | Adding context menu items on game entries via `ctx.registerGameMenuItem`     |
| `ui:sidebar`          | Adding custom sidebar links with real-time progress indicators               |
| `ui:topbar`           | Adding status items to the top navigation bar                                |
| `game:launch-hook`    | Registering pre-launch and post-exit hooks with rollback                     |
| `game:fs`             | Scoped filesystem read/write/backup/restore in game folder                   |
| `game:scan`           | Computing executable hashes and searching install files by path pattern      |
| `client:storage`      | LocalStorage access isolated by plugin ID                                    |
| `client:ws`           | Real-time messaging with server plugin WebSocket channels                    |
| `system:command`      | Running allowlisted native binaries declared in `client.commands`            |
| `system:sidecar`      | Packaging and staging native sidecar binaries in `client.sidecars`           |
| `metadata:provider`   | Registering client metadata providers via `ctx.registerMetadataProvider`     |
| `client:library-scan` | Registering store library scanners via `ctx.registerStoreScanner`            |
| `cloudsave:provider`  | Registering client cloud save resolvers via `ctx.registerCloudSaveResolver`  |
| `game:runner`         | Registering compatibility/emulation runners via `ctx.registerRunnerProvider` |
