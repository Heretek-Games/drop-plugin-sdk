# Community Ecosystem & Architectural Patterns

Drop's extensibility model is built on lessons learned from premier open-source gaming and media managers:

- [Playnite Addons SDK](https://api.playnite.link/docs/manual/gettingStarted/gettingStartedOverview.html)
- [Stash Community Scripts & Scrapers](https://github.com/stashapp/CommunityScripts)
- [RomM Community Extensions](https://docs.romm.app/latest/)

This document outlines how Drop plugins implement recurring community patterns while maintaining clean upstream boundaries.

---

## 1. Playnite-Style Client Extensions

### Play Actions

Playnite's signature feature is the ability for extensions to register custom game actions (e.g. launching with mod organizers, cheats, special graphics renderers, or multiplayer).

In Drop, client plugins use `registerPlayAction`:

```typescript
ctx.registerPlayAction((gameId: string) => [
  {
    id: "gse-lan-room",
    name: "Play Multiplayer Room",
    icon: "heroicons:user-group",
    execute: async (context: LaunchContext) => {
      // Connect to mesh network and stage emulator DLLs before game startup
    },
  },
]);
```

### Fail-Closed Launch Interception

Unlike simple script wrappers, Drop's game launch pipeline enforces ordered lifecycle stages with automatic reverse rollbacks. If a network connection drops or anti-cheat check fails during `pre-launch:network`, completed pre-launch stages (`validate`, `prepare`, `stage`) are rolled back in reverse order:

```
Stage 1: Validate -> Stage 2: Stage DLLs -> Stage 3: Connect VPN (FAILS!)
Rollback: Restore original DLLs <- Clear scratch configs
Result: Game startup safely cancelled, filesystem restored.
```

---

## 2. Stash-Style Community Scrapers & Metadata Providers

In the StashApp ecosystem, scrapers and community scripts run independently of the core server and communicate via standard JSON contracts.

In Drop, plugins like `drop-gamebox` implement community fingerprinting:

1. The desktop client uses `ctx.gameScanner.scanExecutables(gameId)` to compute SHA-256 digests of installed game binaries.
2. The client queries the plugin's REST route: `POST /api/v1/plugins/drop-gamebox/identify` with the executable hash.
3. The server plugin matches the hash against community databases and returns accurate game metadata, release tags, and cloud save directory paths.

---

## 3. Virtual Mesh & P2P Networking

Plugins such as `drop-zerotier` and `drop-federation` manage virtual private networks and peer-to-peer relationships:

1. **Server Side**: Coordinates network membership and manages API tokens in isolated plugin storage (`ctx.storage.set("network_id", ...)`).
2. **Client Side**: Uses `ctx.system.run("zerotier-cli", ["join", networkId])` with explicit command allowlisting to join game rooms without granting arbitrary shell execution privileges.
3. **UI Indicators**: Uses `ctx.registerSlot("topbar:status", ...)` to render real-time connection status in the desktop navigation bar.

---

## 4. Upstream Purity Rule

To preserve compatibility and ease upstream maintenance:

- Drop core platform must contain **zero** references to specific games, piracy groups, scene releases, emulators, or VPN vendors.
- All specialized behaviors live in external plugins built against `@drop-oss/plugin-sdk`.
- Drop core provides only the generic runtime SPI: HTTP routing, WebSocket dispatching, scoped storage, launch hooks, and UI slots.
