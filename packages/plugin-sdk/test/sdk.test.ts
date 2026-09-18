import test from "node:test";
import assert from "node:assert/strict";
import {
  MockPluginContext,
  MockClientPluginContext,
  PLUGIN_API_VERSION,
  SIGNATURE_VERSION,
  SUPPORTED_API_VERSIONS,
  assertManifestSupports,
  compareCapabilities,
  getManifestCapabilities,
  type ServerCapability,
} from "../dist/index.js";

test("PLUGIN_API_VERSION is 2", () => {
  assert.equal(PLUGIN_API_VERSION, 2);
  assert.deepEqual([...SUPPORTED_API_VERSIONS], [1, 2]);
  assert.equal(SIGNATURE_VERSION, 2);
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

test("MockPluginContext fails closed on storage without the storage capability", async () => {
  const ctx = new MockPluginContext("no-storage", ["routes"]);

  await assert.rejects(
    () => ctx.storage.set("key", "value"),
    /missing required capability 'storage'/,
  );
  await assert.rejects(
    () => ctx.storage.get("key"),
    /missing required capability 'storage'/,
  );
  await assert.rejects(
    () => ctx.storage.listKeys(),
    /missing required capability 'storage'/,
  );
  await assert.rejects(
    () => ctx.storage.getSchemaVersion(),
    /missing required capability 'storage'/,
  );
  await assert.rejects(
    () => ctx.storage.setSchemaVersion(2),
    /missing required capability 'storage'/,
  );
  await assert.rejects(
    () => ctx.storage.delete("key"),
    /missing required capability 'storage'/,
  );

  // The guarded storage stays empty because nothing can reach the backing map.
  const allowed = new MockPluginContext("with-storage", ["storage"]);
  await allowed.storage.set("key", "value");
  assert.equal(await allowed.storage.get("key"), "value");
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
  ctx.registerPlayAction((_gameId) => [
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
  const backupPath = await ctx.gameFs.backupFile("game-123", "config.txt");
  assert.equal(backupPath, "config.txt.drop-backup");
  assert.equal(
    await ctx.gameFs.fileExists("game-123", "config.txt.drop-backup"),
    true,
  );

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
  // The desktop host removes the backup once it has been restored.
  assert.equal(
    await ctx.gameFs.fileExists("game-123", "config.txt.drop-backup"),
    false,
  );
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

  let received: unknown = null;
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
    createPaymentIntent: async (_req) => ({
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
    resolveSavePaths: async (_context) => [
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
    resolveSavePaths: async (_context) => [
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
  const restrictedClient = new MockClientPluginContext("restricted", [
    "ui:slot",
  ]);
  assert.throws(() => {
    restrictedClient.registerCloudSaveResolver({
      id: "test",
      name: "Test",
      resolveSavePaths: async () => [],
    });
  }, /missing required capability 'cloudsave:provider'/);
});

test("getManifestCapabilities resolves server from top-level only", () => {
  const manifest = {
    id: "multi",
    capabilities: ["routes", "storage"] as const,
    server: { entry: "s.js", capabilities: ["cloudsave:provider"] as const },
    client: { entry: "c.js", capabilities: ["ui:slot"] as const },
  };
  assert.deepEqual(getManifestCapabilities(manifest, "server").sort(), [
    "routes",
    "storage",
  ]);
});

test("server.capabilities-only declarations are not supported", () => {
  const manifest = {
    id: "wrong-server-scope",
    capabilities: ["routes"] as const,
    server: { entry: "s.js", capabilities: ["network"] as const },
  };

  assert.deepEqual(getManifestCapabilities(manifest, "server"), ["routes"]);
  assert.ok(
    !getManifestCapabilities(manifest, "server").includes("network"),
    "server.capabilities must not be treated as granted",
  );
  assert.throws(
    () =>
      assertManifestSupports(manifest, {
        server: ["routes", "network"],
      }),
    /server: manifest is missing required network/,
  );
});

test("client-scoped capabilities do not leak into the server target", () => {
  const manifest = {
    id: "wrong-client-scope",
    capabilities: ["routes"] as const,
    client: { entry: "c.js", capabilities: ["ui:slot"] as const },
  };

  assert.deepEqual(getManifestCapabilities(manifest, "server"), ["routes"]);
  assert.throws(
    () =>
      assertManifestSupports(manifest, {
        server: ["ui:slot"] as unknown as ServerCapability[],
      }),
    /server: manifest is missing required ui:slot/,
  );
});

test("getManifestCapabilities resolves client from client.capabilities with top-level fallback", () => {
  const scoped = {
    id: "scoped-client",
    capabilities: ["routes"] as const,
    client: { entry: "c.js", capabilities: ["ui:slot"] as const },
  };
  assert.deepEqual(getManifestCapabilities(scoped, "client"), ["ui:slot"]);

  const topLevelOnly = {
    id: "legacy-client",
    capabilities: ["ui:slot"] as const,
  };
  assert.deepEqual(getManifestCapabilities(topLevelOnly, "client"), [
    "ui:slot",
  ]);

  const emptyScoped = {
    id: "empty-client",
    capabilities: ["ui:slot"] as const,
    client: { entry: "c.js", capabilities: [] as const },
  };
  assert.deepEqual(getManifestCapabilities(emptyScoped, "client"), []);
});

test("compareCapabilities reports missing and extra", () => {
  const { missing, extra } = compareCapabilities(
    ["routes", "cloudsave:provider"],
    ["routes", "network"],
  );
  assert.deepEqual(missing, ["cloudsave:provider"]);
  assert.deepEqual(extra, ["network"]);
});

test("assertManifestSupports catches the gamebox-style omission", () => {
  const manifest = {
    id: "drop-gamebox",
    capabilities: ["routes", "storage", "network"] as const,
  };
  assert.throws(
    () =>
      assertManifestSupports(manifest, {
        server: ["routes", "storage", "cloudsave:provider"],
      }),
    /failed capability conformance: server: manifest is missing required cloudsave:provider/,
  );
});

test("assertManifestSupports flags unused capabilities unless allowed", () => {
  const manifest = {
    id: "drop-gse",
    capabilities: [
      "routes",
      "events",
      "storage",
      "websocket",
      "network",
    ] as const,
  };
  const required = {
    server: ["routes", "events", "storage", "websocket"],
  } as const;
  assert.throws(
    () => assertManifestSupports(manifest, required),
    /declares unused network/,
  );
  assert.doesNotThrow(() =>
    assertManifestSupports(manifest, required, { allowExtra: true }),
  );
});

test("assertManifestSupports accepts a matching manifest", () => {
  const manifest = {
    id: "ok",
    capabilities: ["routes", "cloudsave:provider"] as const,
  };
  assert.doesNotThrow(() =>
    assertManifestSupports(manifest, {
      server: ["routes", "cloudsave:provider"],
    }),
  );
});

test("MockClientPluginContext simulates launch pipeline execution and reverse rollback on abort", async () => {
  const ctx = new MockClientPluginContext("launch-test", ["game:launch-hook"]);
  const executionLog: string[] = [];

  ctx.registerLaunchHook({
    stage: "pre-launch:validate",
    order: 10,
    execute: () => {
      executionLog.push("validate-10");
    },
  });

  ctx.registerLaunchHook({
    stage: "pre-launch:validate",
    order: 5,
    execute: () => {
      executionLog.push("validate-5");
    },
  });

  ctx.registerLaunchHook({
    stage: "pre-launch:prepare",
    execute: () => {
      executionLog.push("prepare");
    },
  });

  ctx.registerLaunchHook({
    stage: "post-exit:cleanup",
    execute: () => {
      executionLog.push("cleanup");
    },
  });

  const launchContext = {
    gameId: "game-123",
    gameTitle: "Test Game",
    gameDir: "/games/test",
  };

  // Normal successful launch
  const result = await ctx.executeLaunchPipeline(launchContext, async () => {
    executionLog.push("launch");
    return 42;
  });

  assert.equal(result, 42);
  assert.deepEqual(executionLog, [
    "validate-5",
    "validate-10",
    "prepare",
    "launch",
    "cleanup",
  ]);

  // Launch with failure in pre-launch stage
  executionLog.length = 0;
  ctx.registerLaunchHook({
    stage: "pre-launch:stage",
    execute: () => {
      executionLog.push("stage-fail");
      throw new Error("Staging failed");
    },
  });

  let launchCalled = false;
  await assert.rejects(
    () =>
      ctx.executeLaunchPipeline(launchContext, async () => {
        launchCalled = true;
      }),
    /Launch aborted during stage 'pre-launch:stage': Staging failed/,
  );

  assert.equal(launchCalled, false);
  // Verify rollback recorded completed stages in reverse order
  assert.equal(ctx.rolledBackStages.length, 3);
  assert.equal(ctx.rolledBackStages[0]?.stage, "pre-launch:prepare");
  assert.equal(ctx.rolledBackStages[1]?.stage, "pre-launch:validate");
  assert.equal(ctx.rolledBackStages[2]?.stage, "pre-launch:validate");
});

test("MockClientServerRequest falls back to query-stripped base path", async () => {
  const ctx = new MockClientPluginContext("client-test", []);
  ctx.serverRequestLog.setResponse("GET", "/networks/active", { networks: ["net-1"] });

  // Exact match
  const exact = await ctx.serverRequest("GET", "/networks/active");
  assert.deepEqual(exact, { networks: ["net-1"] });

  // Query parameter fallback
  const withQuery = await ctx.serverRequest("GET", "/networks/active?gameId=game-123");
  assert.deepEqual(withQuery, { networks: ["net-1"] });

  // Exact query override takes precedence if set
  ctx.serverRequestLog.setResponse("GET", "/networks/active?gameId=specific", {
    networks: ["net-special"],
  });
  const specific = await ctx.serverRequest(
    "GET",
    "/networks/active?gameId=specific",
  );
  assert.deepEqual(specific, { networks: ["net-special"] });

  // Fallback for unmatched route
  const unknown = await ctx.serverRequest("GET", "/unknown");
  assert.deepEqual(unknown, {});
});

test("MockClientPluginContext fails closed on storage, gameFs, gameScanner, serverWs when capabilities are undeclared", async () => {
  const ctx = new MockClientPluginContext("restricted-client", ["ui:slot"]);

  // Storage fails closed without 'client:storage'
  await assert.rejects(
    () => ctx.storage.get("key"),
    /missing required capability 'client:storage'/,
  );
  await assert.rejects(
    () => ctx.storage.set("key", "value"),
    /missing required capability 'client:storage'/,
  );
  await assert.rejects(
    () => ctx.storage.delete("key"),
    /missing required capability 'client:storage'/,
  );
  await assert.rejects(
    () => ctx.storage.listKeys(),
    /missing required capability 'client:storage'/,
  );

  // gameFs fails closed without 'game:fs'
  await assert.rejects(
    () => ctx.gameFs.readFile("game-1", "file.txt"),
    /missing required capability 'game:fs'/,
  );
  await assert.rejects(
    () => ctx.gameFs.writeFile("game-1", "file.txt", "data"),
    /missing required capability 'game:fs'/,
  );
  await assert.rejects(
    () => ctx.gameFs.backupFile("game-1", "file.txt"),
    /missing required capability 'game:fs'/,
  );
  await assert.rejects(
    () => ctx.gameFs.restoreFile("game-1", "file.txt"),
    /missing required capability 'game:fs'/,
  );
  await assert.rejects(
    () => ctx.gameFs.fileExists("game-1", "file.txt"),
    /missing required capability 'game:fs'/,
  );
  await assert.rejects(
    () => ctx.gameFs.deleteFile("game-1", "file.txt"),
    /missing required capability 'game:fs'/,
  );

  // gameScanner fails closed without 'game:scan'
  await assert.rejects(
    () => ctx.gameScanner.scanExecutables("game-1"),
    /missing required capability 'game:scan'/,
  );
  await assert.rejects(
    () => ctx.gameScanner.findFiles("game-1", ["*.exe"]),
    /missing required capability 'game:scan'/,
  );

  // serverWs fails closed without 'client:ws'
  await assert.rejects(
    () => ctx.serverWs.send("channel", {}),
    /missing required capability 'client:ws'/,
  );
  assert.throws(
    () => ctx.serverWs.subscribe("channel", () => {}),
    /missing required capability 'client:ws'/,
  );
});

/* ============================== end tests ================================= */

/* (sidecar schema validation tests live in packages/plugin-cli/test/signer.test.ts,
 *  because validateManifest is exported from plugin-cli.) */
