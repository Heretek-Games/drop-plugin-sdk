import type {
  HttpMethod,
  PluginCapability,
  PluginContext,
  PluginLogger,
  PluginStorage,
  RouteHandler,
  SubscriptionAuthorizer,
  WebSocketHandler,
} from "./types.js";

export class MockPluginStorage implements PluginStorage {
  private readonly store = new Map<string, any>();
  private schemaVersion = 0;

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

  async getSchemaVersion(): Promise<number> {
    return this.schemaVersion;
  }

  async setSchemaVersion(version: number): Promise<void> {
    this.schemaVersion = version;
  }
}

export class MockPluginLogger implements PluginLogger {
  info(msg: string, ...args: any[]): void {
    console.log(`[INFO] ${msg}`, ...args);
  }
  warn(msg: string, ...args: any[]): void {
    console.warn(`[WARN] ${msg}`, ...args);
  }
  error(msg: string, ...args: any[]): void {
    console.error(`[ERROR] ${msg}`, ...args);
  }
  debug(msg: string, ...args: any[]): void {
    console.debug(`[DEBUG] ${msg}`, ...args);
  }
}

export class MockPluginContext implements PluginContext {
  public id: string;
  public logger: PluginLogger;
  public storage: PluginStorage;
  public capabilities: Set<PluginCapability>;

  public routes = new Map<string, { method: HttpMethod; pattern: string; handler: RouteHandler }>();
  public wsHandlers = new Map<string, WebSocketHandler>();
  public eventListeners = new Map<string, Set<(event: unknown) => void>>();
  public authorizers: Array<{ matches: (c: string) => boolean; auth: SubscriptionAuthorizer }> = [];

  constructor(id: string, capabilities: PluginCapability[] = ["routes", "storage", "websocket", "events", "network"]) {
    this.id = id;
    this.logger = new MockPluginLogger();
    this.storage = new MockPluginStorage();
    this.capabilities = new Set(capabilities);
  }

  registerRoute(method: HttpMethod, pattern: string, handler: RouteHandler): void {
    this.assertCapability("routes");
    this.routes.set(`${method} ${pattern}`, { method, pattern, handler });
  }

  broadcast(channel: string, event: unknown): void {
    this.assertCapability("events");
    const listeners = this.eventListeners.get(channel);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  subscribe(channel: string, listener: (event: unknown) => void): () => void {
    this.assertCapability("events");
    if (!this.eventListeners.has(channel)) {
      this.eventListeners.set(channel, new Set());
    }
    this.eventListeners.get(channel)!.add(listener);
    return () => {
      this.eventListeners.get(channel)?.delete(listener);
    };
  }

  registerWebSocket(channel: string, handler: WebSocketHandler): void {
    this.assertCapability("websocket");
    this.wsHandlers.set(channel, handler);
  }

  registerSubscriptionAuthorizer(
    matches: (channel: string) => boolean,
    authorize: SubscriptionAuthorizer,
  ): void {
    this.assertCapability("websocket");
    this.authorizers.push({ matches, auth: authorize });
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    this.assertCapability("network");
    return globalThis.fetch(input, init);
  }

  private assertCapability(cap: PluginCapability): void {
    if (!this.capabilities.has(cap)) {
      throw new Error(`Plugin '${this.id}' missing required capability '${cap}'`);
    }
  }
}
