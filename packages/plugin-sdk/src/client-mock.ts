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
  LaunchHook,
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

export class MockClientPluginStorage implements ClientPluginStorage {
  private readonly store = new Map<string, any>();

  async get<T>(key: string): Promise<T | null> {
    return this.store.has(key) ? structuredClone(this.store.get(key)) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

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
    const value = this.responses.has(this.key(method, path))
      ? this.responses.get(this.key(method, path))
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
    this.storage = new MockClientPluginStorage();
    this.capabilities = new Set(capabilities);
    this.gameFs = new MockScopedGameFs();
    this.gameScanner = new MockScopedGameScanner();
    this.serverWs = new MockClientPluginWebSocket();
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

  async resolvePlayActions(gameId: string): Promise<PlayAction[]> {
    const actions: PlayAction[] = [];
    for (const provider of this.playActionProviders) {
      const result = await provider(gameId);
      actions.push(...result);
    }
    return actions;
  }

  private assertCapability(cap: ClientCapability): void {
    if (!this.capabilities.has(cap)) {
      throw new Error(
        `Client plugin '${this.id}' missing required capability '${cap}'`,
      );
    }
  }
}
