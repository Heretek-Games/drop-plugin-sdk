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
  "capabilities": [
    "routes",
    "storage",
    "websocket",
    "events",
    "network",
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
  "server": {
    "entry": "dist/server.js",
    "storageVersion": 1,
    "capabilities": ["routes", "storage", "websocket", "events", "network"]
  },
  "client": {
    "entry": "dist/client.js",
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

- **`apiVersion`** (`integer`, default `2`): Target Drop Plugin API version. Drop core supports versions `[1, 2]`.
- **`trust`** (`"trusted" | "sandboxed"`, default `"trusted"`): Trust tier. Currently, plugins run in-process as `"trusted"`.
- **`storageVersion`** (`integer`, optional): Integer schema version for persistent storage migrations.
- **`targets`** (`Array<"server" | "client">`, required): Platforms the plugin provides code for.

---

## Capabilities Reference

Capabilities are **strictly fail-closed**. If an API is called without the corresponding capability declared in `capabilities`, Drop rejects the operation immediately.

### Server Capabilities

| Capability  | Permitted Operations                                                  |
| :---------- | :-------------------------------------------------------------------- |
| `routes`    | Registering HTTP routes via `ctx.registerRoute`                       |
| `storage`   | Persistent KV access via `ctx.storage` and migrations                 |
| `websocket` | Claiming channels via `ctx.registerWebSocket` and authorizers         |
| `events`    | Emitting and listening to server events via `broadcast` / `subscribe` |
| `network`   | External HTTP egress via `ctx.fetch`                                  |

### Client Capabilities

| Capability         | Permitted Operations                                                     |
| :----------------- | :----------------------------------------------------------------------- |
| `ui:slot`          | Injecting Vue components into UI slots via `ctx.registerSlot`            |
| `ui:play-action`   | Dynamic alternative game startup modes via `ctx.registerPlayAction`      |
| `ui:context-menu`  | Adding context menu items on game entries via `ctx.registerGameMenuItem` |
| `ui:sidebar`       | Adding custom sidebar links with real-time progress indicators           |
| `ui:topbar`        | Adding status items to the top navigation bar                            |
| `game:launch-hook` | Registering pre-launch and post-exit hooks with rollback                 |
| `game:fs`          | Scoped filesystem read/write/backup/restore in game folder               |
| `game:scan`        | Computing executable hashes and detecting anti-cheat software            |
| `client:storage`   | LocalStorage access isolated by plugin ID                                |
| `client:ws`        | Real-time messaging with server plugin WebSocket channels                |
| `system:command`   | Running allowlisted native binaries declared in `client.commands`        |
