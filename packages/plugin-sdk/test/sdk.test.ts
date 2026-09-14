import test from "node:test";
import assert from "node:assert/strict";
import {
  MockPluginContext,
  MockClientPluginContext,
  PLUGIN_API_VERSION,
  type PlayAction,
  type LaunchHook,
} from "../dist/index.js";

test("PLUGIN_API_VERSION is 2", () => {
  assert.equal(PLUGIN_API_VERSION, 2);
});

test("MockPluginContext enforces capability gating", () => {
  const ctx = new MockPluginContext("server-test", ["routes"]);
  ctx.registerRoute("GET", "/test", () => ({ ok: true }));
  assert.ok(ctx.routes.has("GET /test"));

  // Lacks 'websocket' capability
  assert.throws(() => {
    ctx.registerWebSocket("my-channel", () => {});
  }, /missing required capability 'websocket'/);
});

test("MockClientPluginContext registers UI slots and Play Actions", async () => {
  const ctx = new MockClientPluginContext("client-test", [
    "ui:slot",
    "ui:play-action",
    "ui:context-menu",
    "game:launch-hook",
    "game:fs",
    "game:scan",
    "client:storage",
  ]);

  // UI slot
  const dummyComponent = { template: "<div>Hello</div>" };
  ctx.registerSlot("game-detail:actions", dummyComponent, { order: 10 });
  const slots = ctx.registeredSlots.get("game-detail:actions");
  assert.equal(slots?.length, 1);
  assert.equal(slots[0].order, 10);

  // Play Action
  ctx.registerPlayAction((gameId) => [
    {
      id: "action-multiplayer",
      name: "Play Multiplayer Room",
      execute: () => {},
    },
  ]);

  const actions = await ctx.resolvePlayActions("game-123");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].name, "Play Multiplayer Room");

  // Scoped Game FS
  await ctx.gameFs.writeFile("game-123", "config.txt", "port=1234");
  assert.equal(await ctx.gameFs.fileExists("game-123", "config.txt"), true);
  const hash = await ctx.gameFs.backupFile("game-123", "config.txt");
  assert.ok(hash.startsWith("mock-sha256"));

  // Overwrite and restore
  await ctx.gameFs.writeFile("game-123", "config.txt", "mutated");
  const mutated = new TextDecoder().decode(
    await ctx.gameFs.readFile("game-123", "config.txt"),
  );
  assert.equal(mutated, "mutated");

  await ctx.gameFs.restoreFile("game-123", "config.txt");
  const restored = new TextDecoder().decode(
    await ctx.gameFs.readFile("game-123", "config.txt"),
  );
  assert.equal(restored, "port=1234");
});

test("MockClientPluginContext throws on undeclared capability", () => {
  const ctx = new MockClientPluginContext("restricted-plugin", ["ui:slot"]);

  assert.throws(() => {
    ctx.registerPlayAction(() => []);
  }, /missing required capability 'ui:play-action'/);
});

test("PluginRpcClient sends messages through WebSocket mock", async () => {
  const ctx = new MockClientPluginContext("my-plugin");
  const rpc = new (await import("../dist/index.js")).PluginRpcClient({
    pluginId: "my-plugin",
    ws: ctx.serverWs,
  });

  let received: any = null;
  rpc.subscribeWs("my-channel", (data) => {
    received = data;
  });

  ctx.serverWs.simulateServerMessage("my-channel", { ping: "pong" });
  assert.deepEqual(received, { ping: "pong" });

  const sendRes = await rpc.sendWs("my-channel", { hello: "server" });
  assert.deepEqual(sendRes, { ack: true });
  assert.equal(ctx.serverWs.sentMessages.length, 1);
});

test("MockPluginContext registers metadata providers and payment gateways", () => {
  const ctx = new MockPluginContext("server-spi-test", [
    "metadata:provider",
    "commerce:payment",
  ]);

  // Metadata Provider
  ctx.registerMetadataProvider({
    id: "steamgriddb",
    name: "SteamGridDB",
    search: async (query) => [
      { id: "sgdb-1", title: query, provider: "steamgriddb" },
    ],
    getDetails: async (id) => ({
      id,
      title: "Test Game",
      provider: "steamgriddb",
    }),
  });
  assert.ok(ctx.metadataProviders.has("steamgriddb"));

  // Payment Gateway
  ctx.registerPaymentGateway({
    id: "stripe",
    name: "Stripe",
    createPaymentIntent: async (req) => ({
      intentId: "pi_123",
      status: "pending",
    }),
    handleWebhook: async () => ({
      orderId: "ord_1",
      status: "succeeded",
      transactionId: "tx_1",
    }),
  });
  assert.ok(ctx.paymentGateways.has("stripe"));

  // Duplicate registration throws
  assert.throws(() => {
    ctx.registerMetadataProvider({
      id: "steamgriddb",
      name: "Duplicate SteamGridDB",
      search: async () => [],
      getDetails: async () => null,
    });
  }, /Metadata provider 'steamgriddb' is already registered/);

  assert.throws(() => {
    ctx.registerPaymentGateway({
      id: "stripe",
      name: "Duplicate Stripe",
      createPaymentIntent: async () => ({ intentId: "", status: "failed" }),
      handleWebhook: async () => ({
        orderId: "",
        status: "failed",
        transactionId: "",
      }),
    });
  }, /Payment gateway 'stripe' is already registered/);

  // Invalid ID throws
  assert.throws(() => {
    ctx.registerMetadataProvider({
      id: "   ",
      name: "Empty",
      search: async () => [],
      getDetails: async () => null,
    });
  }, /Metadata provider must have a valid non-empty id/);

  assert.throws(() => {
    ctx.registerPaymentGateway({
      id: "",
      name: "Empty",
      createPaymentIntent: async () => ({ intentId: "", status: "failed" }),
      handleWebhook: async () => ({
        orderId: "",
        status: "failed",
        transactionId: "",
      }),
    });
  }, /Payment gateway must have a valid non-empty id/);

  // Lacking capabilities throws
  const restricted = new MockPluginContext("restricted", ["routes"]);
  assert.throws(() => {
    restricted.registerMetadataProvider({
      id: "denied",
      name: "Denied",
      search: async () => [],
      getDetails: async () => null,
    });
  }, /missing required capability 'metadata:provider'/);

  assert.throws(() => {
    restricted.registerPaymentGateway({
      id: "denied-pay",
      name: "Denied",
      createPaymentIntent: async () => ({ intentId: "", status: "failed" }),
      handleWebhook: async () => ({
        orderId: "",
        status: "failed",
        transactionId: "",
      }),
    });
  }, /missing required capability 'commerce:payment'/);
});

test("MockClientPluginContext registers store scanners, overlay slots, and enforces capability", async () => {
  const ctx = new MockClientPluginContext("scanner-test", [
    "client:library-scan",
    "ui:slot",
  ]);

  // Test overlay slots
  ctx.registerSlot("overlay:panel", { template: "<div>Overlay Panel</div>" });
  ctx.registerSlot("overlay:quick-access", {
    template: "<div>Quick Access</div>",
  });
  assert.equal(ctx.registeredSlots.get("overlay:panel")?.length, 1);
  assert.equal(ctx.registeredSlots.get("overlay:quick-access")?.length, 1);

  const unregister = ctx.registerStoreScanner({
    id: "gog-scanner",
    name: "GOG Galaxy Scanner",
    store: "gog",
    scan: async () => [
      {
        externalId: "gog-1",
        store: "gog",
        title: "The Witcher 3",
        installPath: "/games/witcher3",
      },
    ],
  });

  assert.equal(ctx.storeScanners.length, 1);
  assert.equal(ctx.storeScanners[0].id, "gog-scanner");
  const games = await ctx.storeScanners[0].scan();
  assert.equal(games.length, 1);
  assert.equal(games[0].title, "The Witcher 3");

  unregister();
  assert.equal(ctx.storeScanners.length, 0);

  // Invalid ID throws
  assert.throws(() => {
    ctx.registerStoreScanner({
      id: "",
      name: "Invalid",
      store: "gog",
      scan: async () => [],
    });
  }, /Store scanner must have a valid non-empty id/);

  // Missing capability throws
  const restricted = new MockClientPluginContext("restricted-scanner", [
    "ui:slot",
  ]);
  assert.throws(() => {
    restricted.registerStoreScanner({
      id: "epic",
      name: "Epic",
      store: "epic",
      scan: async () => [],
    });
  }, /missing required capability 'client:library-scan'/);
});

test("MockPluginContext and MockClientPluginContext register and gate CloudSavePathResolver", async () => {
  // Server context
  const serverCtx = new MockPluginContext("server-cloudsave-test", [
    "cloudsave:provider",
  ]);

  serverCtx.registerCloudSaveResolver({
    id: "ludusavi-server",
    name: "Ludusavi Server Resolver",
    resolveSavePaths: async (context) => [
      { pattern: "%APPDATA%/SaveGames", platform: "windows" },
    ],
  });
  assert.ok(serverCtx.cloudSaveResolvers.has("ludusavi-server"));

  // Duplicate registration throws
  assert.throws(() => {
    serverCtx.registerCloudSaveResolver({
      id: "ludusavi-server",
      name: "Duplicate",
      resolveSavePaths: async () => [],
    });
  }, /Cloud save resolver 'ludusavi-server' is already registered/);

  // Client context
  const clientCtx = new MockClientPluginContext("client-cloudsave-test", [
    "cloudsave:provider",
  ]);

  const unregister = clientCtx.registerCloudSaveResolver({
    id: "ludusavi-client",
    name: "Ludusavi Client Resolver",
    resolveSavePaths: async (context) => [
      { pattern: "~/.local/share/saves", platform: "linux" },
    ],
  });

  assert.equal(clientCtx.cloudSaveResolvers.length, 1);
  const patterns = await clientCtx.cloudSaveResolvers[0].resolveSavePaths({
    gameId: "game-1",
    gameTitle: "Test Game",
  });
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].platform, "linux");

  unregister();
  assert.equal(clientCtx.cloudSaveResolvers.length, 0);

  // Missing capability throws
  const restrictedClient = new MockClientPluginContext("restricted", ["ui:slot"]);
  assert.throws(() => {
    restrictedClient.registerCloudSaveResolver({
      id: "test",
      name: "Test",
      resolveSavePaths: async () => [],
    });
  }, /missing required capability 'cloudsave:provider'/);
});
