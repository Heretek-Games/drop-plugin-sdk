# Server Plugins Architecture & Guide

Server plugins in Drop run in-process on the Nitro / Node.js backend. They extend the platform's API surface, manage isolated storage, coordinate real-time WebSocket communication, and respond to server lifecycle events.

---

## The `ServerPlugin` Interface

A server plugin must export a class or object implementing `ServerPlugin`:

```typescript
import type {
  PluginContext,
  ServerPlugin,
  PluginStorage,
} from "@droposs/plugin-sdk";

export default class ExampleServerPlugin implements ServerPlugin {
  metadata = {
    id: "example-server",
    name: "Example Server Extension",
    version: "1.0.0",
    apiVersion: 2,
    storageVersion: 2,
    targets: ["server" as const],
    capabilities: [
      "routes" as const,
      "storage" as const,
      "websocket" as const,
      "events" as const,
      "network" as const,
    ],
  };

  async init(ctx: PluginContext): Promise<void> {
    // Initialization logic
  }

  async teardown?(): Promise<void> {
    // Teardown & resource cleanup
  }

  async migrateStorage?(
    from: number,
    to: number,
    storage: PluginStorage,
  ): Promise<void> {
    // Applied when storage schema version upgrades
  }
}
```

---

## 1. REST Routes (`routes` Capability)

Server plugins can register custom HTTP routes prefixed under `/api/v1/plugins/<pluginId>/...`.

### Route Registration

```typescript
ctx.registerRoute(
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL",
  pattern: string,
  handler: (event: H3Event, context: RouteHandlerContext) => unknown
);
```

### Route Pattern Matching

- **Exact**: `"/status"` matches `/api/v1/plugins/<id>/status`
- **Named Parameters**: `"/rooms/:roomId"` matches `/api/v1/plugins/<id>/rooms/abc` (`context.params.roomId === "abc"`)
- **Wildcard**: `"/assets/**"` captures subpaths (`context.params[0]`)

### Example: Handling Request Bodies and Query Parameters

```typescript
import { readBody } from "h3";

ctx.registerRoute("POST", "/rooms", async (event, routeCtx) => {
  // Check user authentication
  if (!routeCtx.userId) {
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication required",
    });
  }

  const body = await readBody(event);
  const roomName = body?.name;

  return { created: true, roomId: "room-123", owner: routeCtx.userId };
});
```

---

## 2. Isolated Persistent Storage (`storage` Capability)

Every plugin receives an isolated, namespaced key-value storage engine (`PluginStorage`).

### API Surface

```typescript
interface PluginStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
  getSchemaVersion(): Promise<number>;
  setSchemaVersion(version: number): Promise<void>;
}
```

### Schema Migrations (`migrateStorage`)

When a plugin updates its `metadata.storageVersion` (e.g. from `1` to `2`), Drop automatically invokes `migrateStorage(from, to, storage)` during startup before `init(ctx)`:

```typescript
async migrateStorage(from: number, to: number, storage: PluginStorage): Promise<void> {
  if (from === 0 && to >= 1) {
    // Initial schema setup
    await storage.set("default_channel", "general");
  }
  if (from === 1 && to === 2) {
    // Migrate legacy room records to new format
    const legacy = await storage.get<Record<string, any>>("rooms_v1");
    if (legacy) {
      for (const [id, room] of Object.entries(legacy)) {
        await storage.set(`room:${id}`, { ...room, migratedAt: Date.now() });
      }
      await storage.delete("rooms_v1");
    }
  }
}
```

---

## 3. Real-Time WebSockets (`websocket` Capability)

Drop provides a unified, crossws-backed WebSocket gateway at `/api/v1/plugins/ws`. Plugins claim channels globally and handle real-time client messages.

### Channel Registration

```typescript
// 1. Authenticated channel (default)
ctx.registerWebSocket("my-plugin:chat", async (message, wsCtx) => {
  ctx.logger.info(`Message from user ${wsCtx.userId}:`, message);
  wsCtx.send({ echo: message });
});

// 2. Public / Anonymous channel (e.g. game lobby listing or server ping)
ctx.registerWebSocket("my-plugin:public-lobbies", (message, wsCtx) => {
  wsCtx.send({ lobbies: [...] });
}, { public: true });

// Or declare a public channel explicitly:
ctx.registerPublicWebSocketChannel("my-plugin:announcements");
```

### Subscription Authorizers

To restrict who can subscribe to a channel, register an authorizer:

```typescript
ctx.registerSubscriptionAuthorizer(
  (channel) => channel.startsWith("my-plugin:room:"),
  async (channel, subCtx) => {
    const roomId = channel.split(":")[2];
    const room = await ctx.storage.get(`room:${roomId}`);
    // Only allow members of this room
    return Boolean(room && room.members.includes(subCtx.userId));
  },
);
```

---

## 4. Cross-Plugin Event Bus (`events` Capability)

Server plugins can emit and subscribe to in-memory events across the server process:

```typescript
// Broadcast an event
ctx.broadcast("library:game-indexed", { gameId: "g1", sha256: "..." });

// Subscribe to events
const unsubscribe = ctx.subscribe("library:game-indexed", (event) => {
  ctx.logger.info("New game indexed:", event);
});

// Auto-unsubscribed when the plugin is unregistered
```

---

## 5. Network Egress (`network` Capability)

To make external API calls (e.g., querying external scrapers or peer instances), plugins must explicitly declare the `network` capability:

```typescript
const res = await ctx.fetch("https://api.example.com/metadata", {
  headers: { "User-Agent": "Drop-Plugin/1.0" },
});
const data = await res.json();
```

Calling `ctx.fetch()` without the `network` capability throws a `PluginCapabilityError` immediately (fail-closed).
