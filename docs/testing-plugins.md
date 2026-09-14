# Testing Drop Plugins

Unit testing is an essential part of the Drop plugin ecosystem. Because plugins execute in-process and interact with system resources, `@droposs/plugin-sdk` provides test harnesses (`MockPluginContext` and `MockClientPluginContext`) that replicate runtime contracts and security boundaries without requiring a full Drop server or desktop application.

---

## 1. Testing Server Plugins (`MockPluginContext`)

`MockPluginContext` provides:

- In-memory route registration and dispatch testing.
- In-memory persistent key-value storage (`MockPluginStorage`) with schema migration simulation.
- In-memory WebSocket handler simulation.
- Real-time capability enforcement (asserts that undeclared capabilities throw immediately).

### Example: Testing Routes & Storage

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import MyServerPlugin from "../src/index.js";

test("MyServerPlugin initializes and serves routes", async () => {
  // 1. Instantiate the mock context with declared capabilities
  const ctx = new MockPluginContext("my-plugin", ["routes", "storage"]);

  // 2. Initialize the plugin under test
  const plugin = new MyServerPlugin();
  await plugin.init(ctx);

  // 3. Verify route registration
  assert.equal(ctx.routes.has("GET:/status"), true);

  // 4. Execute the route handler directly
  const handler = ctx.routes.get("GET:/status")!;
  const response = (await handler({} as any, {
    params: {},
    query: {},
    userId: "test-user",
  })) as any;

  assert.equal(response.status, "ok");

  // 5. Verify storage mutations
  const stored = await ctx.storage.get("last_check");
  assert.notEqual(stored, null);
});
```

### Example: Verifying Capability Gating

```typescript
test("Server plugin fails closed on undeclared capabilities", async () => {
  // Context without 'storage' capability
  const ctx = new MockPluginContext("restricted-plugin", ["routes"]);

  assert.throws(() => {
    // Attempting to access storage throws
    ctx.storage.set("key", "value");
  }, /missing required capability 'storage'/);
});
```

---

## 2. Testing Desktop Client Plugins (`MockClientPluginContext`)

`MockClientPluginContext` provides:

- Mock Scoped Game Filesystem (`MockScopedGameFs`).
- Mock Executable Scanner & Anti-Cheat detection (`MockScopedGameScanner`).
- Recorded UI slot registrations and Play Action providers.
- Recorded game launch hooks.

### Example: Testing Launch Hooks & Game Filesystem

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockClientPluginContext } from "@droposs/plugin-sdk";
import MyClientPlugin from "../src/client.js";

test("Client plugin stages file in pre-launch hook", async () => {
  const ctx = new MockClientPluginContext("my-client-plugin", [
    "game:launch-hook",
    "game:fs",
  ]);

  // Seed existing file in the mock game directory
  await ctx.gameFs.writeFile("game-123", "original.dll", "original-bytes");

  const plugin = new MyClientPlugin();
  await plugin.init(ctx);

  // Verify launch hook registration
  const stageHook = ctx.launchHooks.find((h) => h.stage === "pre-launch:stage");
  assert.ok(stageHook);

  // Execute hook
  await stageHook.execute({
    gameId: "game-123",
    gameTitle: "Test Game",
    gameDir: "/games/test",
  });

  // Verify backup created and new file written
  assert.equal(
    await ctx.gameFs.fileExists("game-123", "original.dll.drop-backup"),
    true,
  );
});
```

---

## 3. Running Tests with Node.js Native Test Runner

Drop plugins use Node's built-in, fast test runner (`node:test`). Add the test script in `package.json`:

```json
{
  "scripts": {
    "test": "node --test dist/test/*.js",
    "build": "drop-plugin build ."
  }
}
```

Or execute tests via the CLI:

```bash
npx drop-plugin test .
```
