import { MockKeyValueStore } from "./mock-core.js";
import { MockPluginLogger } from "./mock.js";
import type {
  ClientCapability,
  ClientPluginContext,
  ClientPluginStorage,
  ClientPluginSystem,
  ClientPluginWebSocket,
  CloudSavePathResolver,
  CommandOptions,
  CommandResult,
  GameMenuItem,
  HttpMethod,
  LaunchContext,
  LaunchHook,
  LaunchStage,
  MetadataProvider,
  PlayAction,
  PluginLogger,
  ScopedGameFs,
  ScopedGameScanner,
  SidebarItem,
  StoreScanner,
  TopBarItem,
  UISlotName,
  UISlotRegistration,
} from "./types.js";

export class MockClientPluginStorage
  extends MockKeyValueStore
  implements ClientPluginStorage {}

export class MockScopedGameFs implements ScopedGameFs {
  public files = new Map<string, Uint8Array>();

  private makeKey(gameId: string, path: string): string {
    return `${gameId}:${path.replaceAll("\\", "/")}`;
  }

  async readFile(gameId: string, relativePath: string): Promise<Uint8Array> {
    const key = this.makeKey(gameId, relativePath);
    const content = this.files.get(key);
    if (!content) {
      throw new Error(`File not found: ${relativePath}`);
    }
    return new Uint8Array(content);
  }

  async writeFile(
    gameId: string,
    relativePath: string,
    data: Uint8Array | string,
  ): Promise<void> {
    const key = this.makeKey(gameId, relativePath);
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.files.set(key, bytes);
  }

  /**
   * Copy `relativePath` to `<relativePath>.drop-backup` and return the backup
   * path, mirroring the desktop host's `plugin_game_fs_backup` command.
   */
  async backupFile(gameId: string, relativePath: string): Promise<string> {
    const key = this.makeKey(gameId, relativePath);
    const content = this.files.get(key);
    if (!content) {
      throw new Error(`Cannot backup non-existent file: ${relativePath}`);
    }
    const backupRelative = `${relativePath}.drop-backup`;
    this.files.set(
      this.makeKey(gameId, backupRelative),
      new Uint8Array(content),
    );
    return backupRelative;
  }

  /**
   * Restore `relativePath` from its `.drop-backup` copy and delete the backup,
   * mirroring the desktop host's `plugin_game_fs_restore` command.
   */
  async restoreFile(gameId: string, relativePath: string): Promise<void> {
    const key = this.makeKey(gameId, relativePath);
    const backupKey = this.makeKey(gameId, `${relativePath}.drop-backup`);
    const backup = this.files.get(backupKey);
    if (!backup) {
      throw new Error(`No backup found for: ${relativePath}`);
    }
    this.files.set(key, new Uint8Array(backup));
    this.files.delete(backupKey);
  }

  async fileExists(gameId: string, relativePath: string): Promise<boolean> {
    const key = this.makeKey(gameId, relativePath);
    return this.files.has(key);
  }

  async deleteFile(gameId: string, relativePath: string): Promise<void> {
    const key = this.makeKey(gameId, relativePath);
    this.files.delete(key);
  }
}

export class MockScopedGameScanner implements ScopedGameScanner {
  public mockExecutables: Array<{
    relativePath: string;
    sha256: string;
    size: number;
  }> = [];
  /** Installed files returned by `findFiles`, filtered by pattern. */
  public mockInstalledFiles: string[] = [];

  async scanExecutables(
    _gameId: string,
  ): Promise<Array<{ relativePath: string; sha256: string; size: number }>> {
    return [...this.mockExecutables];
  }

  async findFiles(_gameId: string, patterns: string[]): Promise<string[]> {
    const lowered = patterns.map((pattern) => pattern.toLowerCase());
    return this.mockInstalledFiles.filter((file) =>
      lowered.some((pattern) => file.toLowerCase().includes(pattern)),
    );
  }
}

export class MockClientPluginWebSocket implements ClientPluginWebSocket {
  public sentMessages: Array<{ channel: string; data: unknown }> = [];
  public subscribers = new Map<string, Set<(data: unknown) => void>>();

  async send(channel: string, data: unknown): Promise<unknown> {
    this.sentMessages.push({ channel, data });
    return { ack: true };
  }

  subscribe(channel: string, listener: (data: unknown) => void): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(listener);
    return () => {
      this.subscribers.get(channel)?.delete(listener);
    };
  }

  simulateServerMessage(channel: string, data: unknown): void {
    const set = this.subscribers.get(channel);
    if (set) {
      for (const listener of set) {
        listener(data);
      }
    }
  }
}

export class MockClientServerRequest {
  public calls: Array<{ method: HttpMethod; path: string; body?: unknown }> =
    [];
  public responses = new Map<string, unknown>();
  /** Value returned when no canned response is registered. */
  public fallback: unknown = {};

  private key(method: HttpMethod, path: string): string {
    const clean = path.startsWith("/") ? path : `/${path}`;
    return `${method.toUpperCase()} ${clean}`;
  }

  setResponse(method: HttpMethod, path: string, value: unknown): void {
    this.responses.set(this.key(method, path), value);
  }

  async request<T = unknown>(
    method: HttpMethod,
    path = "",
    body?: unknown,
  ): Promise<T> {
    this.calls.push({ method, path, body });
    const fullKey = this.key(method, path);
    const basePath = path.split("?")[0];
    const baseKey = this.key(method, basePath);
    const value = this.responses.has(fullKey)
      ? this.responses.get(fullKey)
      : this.responses.has(baseKey)
      ? this.responses.get(baseKey)
      : this.fallback;
    return value as T;
  }
}

export class MockSystemCommand implements ClientPluginSystem {
  public calls: Array<{
    bin: string;
    args: string[];
    options?: CommandOptions;
  }> = [];
  public responses = new Map<string, CommandResult>();
  /** Result returned when no canned response is registered. */
  public fallback: CommandResult = { code: 0, stdout: "", stderr: "" };

  private key(bin: string, args: string[]): string {
    return [bin, ...args].join(" ");
  }

  setResponse(bin: string, args: string[], result: CommandResult): void {
    this.responses.set(this.key(bin, args), result);
  }

  async run(
    bin: string,
    args: string[] = [],
    options?: CommandOptions,
  ): Promise<CommandResult> {
    this.calls.push({ bin, args, options });
    const result = this.responses.get(this.key(bin, args)) ?? this.fallback;
    return { ...result };
  }
}

function guardClientStorage(pluginId: string): ClientPluginStorage {
  const deny = (operation: string): never => {
    throw new Error(
      `Client plugin '${pluginId}' missing required capability 'client:storage' (${operation})`,
    );
  };
  return {
    get: async () => deny("storage.get"),
    set: async () => deny("storage.set"),
    delete: async () => deny("storage.delete"),
    listKeys: async () => deny("storage.listKeys"),
  };
}

function guardGameFs(pluginId: string): MockScopedGameFs {
  const deny = (operation: string): never => {
    throw new Error(
      `Client plugin '${pluginId}' missing required capability 'game:fs' (${operation})`,
    );
  };
  const guarded = new MockScopedGameFs();
  guarded.readFile = async () => deny("gameFs.readFile");
  guarded.writeFile = async () => deny("gameFs.writeFile");
  guarded.backupFile = async () => deny("gameFs.backupFile");
  guarded.restoreFile = async () => deny("gameFs.restoreFile");
  guarded.fileExists = async () => deny("gameFs.fileExists");
  guarded.deleteFile = async () => deny("gameFs.deleteFile");
  return guarded;
}

function guardGameScanner(pluginId: string): MockScopedGameScanner {
  const deny = (operation: string): never => {
    throw new Error(
      `Client plugin '${pluginId}' missing required capability 'game:scan' (${operation})`,
    );
  };
  const guarded = new MockScopedGameScanner();
  guarded.scanExecutables = async () => deny("gameScanner.scanExecutables");
  guarded.findFiles = async () => deny("gameScanner.findFiles");
  return guarded;
}

function guardClientWs(pluginId: string): MockClientPluginWebSocket {
  const deny = (operation: string): never => {
    throw new Error(
      `Client plugin '${pluginId}' missing required capability 'client:ws' (${operation})`,
    );
  };
  const guarded = new MockClientPluginWebSocket();
  guarded.send = async () => deny("serverWs.send");
  guarded.subscribe = () => deny("serverWs.subscribe");
  return guarded;
}

export class MockClientPluginContext implements ClientPluginContext {
  public id: string;
  public logger: PluginLogger;
  public storage: ClientPluginStorage;
  public capabilities: Set<ClientCapability>;

  public registeredSlots = new Map<UISlotName, UISlotRegistration[]>();
  public playActionProviders: Array<
    (gameId: string) => Promise<PlayAction[]> | PlayAction[]
  > = [];
  public gameMenuItems: GameMenuItem[] = [];
  public sidebarItems: SidebarItem[] = [];
  public topBarItems: TopBarItem[] = [];
  public launchHooks: LaunchHook[] = [];
  public storeScanners: StoreScanner[] = [];
  public metadataProviders: MetadataProvider[] = [];
  public cloudSaveResolvers: CloudSavePathResolver[] = [];

  public gameFs: MockScopedGameFs;
  public gameScanner: MockScopedGameScanner;
  public serverWs: MockClientPluginWebSocket;
  public serverRequestLog: MockClientServerRequest;
  public systemCommand: MockSystemCommand;
  public system: ClientPluginSystem;

  constructor(
    id: string,
    capabilities: ClientCapability[] = [
      "ui:slot",
      "ui:play-action",
      "ui:context-menu",
      "ui:sidebar",
      "ui:topbar",
      "game:launch-hook",
      "game:fs",
      "game:scan",
      "client:storage",
      "client:ws",
    ],
  ) {
    this.id = id;
    this.logger = new MockPluginLogger();
    this.capabilities = new Set(capabilities);
    this.storage = this.capabilities.has("client:storage")
      ? new MockClientPluginStorage()
      : guardClientStorage(id);
    this.gameFs = this.capabilities.has("game:fs")
      ? new MockScopedGameFs()
      : guardGameFs(id);
    this.gameScanner = this.capabilities.has("game:scan")
      ? new MockScopedGameScanner()
      : guardGameScanner(id);
    this.serverWs = this.capabilities.has("client:ws")
      ? new MockClientPluginWebSocket()
      : guardClientWs(id);
    this.serverRequestLog = new MockClientServerRequest();
    this.systemCommand = new MockSystemCommand();
    this.system = {
      run: async (bin, args, options) => {
        this.assertCapability("system:command");
        return await this.systemCommand.run(bin, args, options);
      },
    };
  }

  registerSlot(
    slot: UISlotName,
    component: unknown,
    options: { order?: number; label?: string; icon?: string } = {},
  ): void {
    this.assertCapability("ui:slot");
    if (!this.registeredSlots.has(slot)) {
      this.registeredSlots.set(slot, []);
    }
    this.registeredSlots.get(slot)!.push({
      slot,
      component,
      order: options.order ?? 0,
      label: options.label,
      icon: options.icon,
    });
  }

  registerPlayAction(
    provider: (gameId: string) => Promise<PlayAction[]> | PlayAction[],
  ): () => void {
    this.assertCapability("ui:play-action");
    this.playActionProviders.push(provider);
    return () => {
      const idx = this.playActionProviders.indexOf(provider);
      if (idx !== -1) this.playActionProviders.splice(idx, 1);
    };
  }

  registerGameMenuItem(item: GameMenuItem): () => void {
    this.assertCapability("ui:context-menu");
    this.gameMenuItems.push(item);
    return () => {
      const idx = this.gameMenuItems.indexOf(item);
      if (idx !== -1) this.gameMenuItems.splice(idx, 1);
    };
  }

  registerSidebarItem(item: SidebarItem): () => void {
    this.assertCapability("ui:sidebar");
    this.sidebarItems.push(item);
    return () => {
      const idx = this.sidebarItems.indexOf(item);
      if (idx !== -1) this.sidebarItems.splice(idx, 1);
    };
  }

  registerTopBarItem(item: TopBarItem): () => void {
    this.assertCapability("ui:topbar");
    this.topBarItems.push(item);
    return () => {
      const idx = this.topBarItems.indexOf(item);
      if (idx !== -1) this.topBarItems.splice(idx, 1);
    };
  }

  registerLaunchHook(hook: LaunchHook): () => void {
    this.assertCapability("game:launch-hook");
    this.launchHooks.push(hook);
    return () => {
      const idx = this.launchHooks.indexOf(hook);
      if (idx !== -1) this.launchHooks.splice(idx, 1);
    };
  }

  registerStoreScanner(scanner: StoreScanner): () => void {
    if (!scanner || typeof scanner.id !== "string" || !scanner.id.trim()) {
      throw new Error("Store scanner must have a valid non-empty id");
    }
    this.assertCapability("client:library-scan");
    this.storeScanners.push(scanner);
    return () => {
      const idx = this.storeScanners.indexOf(scanner);
      if (idx !== -1) this.storeScanners.splice(idx, 1);
    };
  }

  registerMetadataProvider(provider: MetadataProvider): () => void {
    if (!provider || typeof provider.id !== "string" || !provider.id.trim()) {
      throw new Error("Metadata provider must have a valid non-empty id");
    }
    this.assertCapability("metadata:provider");
    this.metadataProviders.push(provider);
    return () => {
      const idx = this.metadataProviders.indexOf(provider);
      if (idx !== -1) this.metadataProviders.splice(idx, 1);
    };
  }

  registerCloudSaveResolver(resolver: CloudSavePathResolver): () => void {
    if (!resolver || typeof resolver.id !== "string" || !resolver.id.trim()) {
      throw new Error("Cloud save resolver must have a valid non-empty id");
    }
    this.assertCapability("cloudsave:provider");
    this.cloudSaveResolvers.push(resolver);
    return () => {
      const idx = this.cloudSaveResolvers.indexOf(resolver);
      if (idx !== -1) this.cloudSaveResolvers.splice(idx, 1);
    };
  }

  async serverRequest<T = unknown>(
    method: HttpMethod,
    path = "",
    body?: unknown,
  ): Promise<T> {
    return this.serverRequestLog.request<T>(method, path, body);
  }

  public rolledBackStages: LaunchHook[] = [];

  async resolvePlayActions(gameId: string): Promise<PlayAction[]> {
    const actions: PlayAction[] = [];
    for (const provider of this.playActionProviders) {
      const result = await provider(gameId);
      actions.push(...result);
    }
    return actions;
  }

  /**
   * Playnite-style Game Launch Pipeline simulator for testing launch hooks and stage rollbacks.
   */
  async executeLaunchPipeline<T>(
    context: LaunchContext,
    launchFn: () => Promise<T>,
  ): Promise<T> {
    const preLaunchStages: LaunchStage[] = [
      "pre-launch:validate",
      "pre-launch:prepare",
      "pre-launch:stage",
      "pre-launch:network",
      "pre-launch:network-post",
    ];

    const postExitStages: LaunchStage[] = [
      "post-exit:cleanup",
      "post-exit:restore",
      "post-exit:sync",
    ];

    const sortHooks = (stages: LaunchStage[]): LaunchHook[] => {
      return this.launchHooks
        .filter((h) => stages.includes(h.stage))
        .sort((a, b) => {
          const stageDiff = stages.indexOf(a.stage) - stages.indexOf(b.stage);
          if (stageDiff !== 0) return stageDiff;
          return (a.order ?? 0) - (b.order ?? 0);
        });
    };

    const completedHooks: LaunchHook[] = [];
    const activePreHooks = sortHooks(preLaunchStages);

    for (const hook of activePreHooks) {
      try {
        await hook.execute(context);
        completedHooks.push(hook);
      } catch (error) {
        this.rolledBackStages = [];
        for (let i = completedHooks.length - 1; i >= 0; i--) {
          const rollbackHook = completedHooks[i];
          if (rollbackHook) {
            this.rolledBackStages.push(rollbackHook);
          }
        }
        throw new Error(
          `Launch aborted during stage '${hook.stage}': ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    }

    const launchResult = await launchFn();

    const activePostHooks = sortHooks(postExitStages);
    for (const hook of activePostHooks) {
      try {
        await hook.execute(context);
      } catch (postErr) {
        this.logger.warn(
          `Post-exit hook warning on stage ${hook.stage}`,
          postErr,
        );
      }
    }

    return launchResult;
  }

  private assertCapability(cap: ClientCapability): void {
    if (!this.capabilities.has(cap)) {
      throw new Error(
        `Client plugin '${this.id}' missing required capability '${cap}'`,
      );
    }
  }
}
