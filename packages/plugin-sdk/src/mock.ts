import { MockKeyValueStore } from "./mock-core.js";
import type {
  AuthProvider,
  CloudSavePathResolver,
  DepotStorageProvider,
  HttpMethod,
  MetadataProvider,
  PaymentGateway,
  PluginCapability,
  PluginContext,
  PluginLogger,
  PluginStorage,
  RouteHandler,
  SubscriptionAuthorizer,
  WebSocketHandler,
} from "./types.js";

export class MockPluginStorage
  extends MockKeyValueStore
  implements PluginStorage
{
  private schemaVersion = 0;

  async getSchemaVersion(): Promise<number> {
    return this.schemaVersion;
  }

  async setSchemaVersion(version: number): Promise<void> {
    this.schemaVersion = version;
  }
}

export class MockPluginLogger implements PluginLogger {
  info(msg: string, ...args: unknown[]): void {
    console.log(`[INFO] ${msg}`, ...args);
  }
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${msg}`, ...args);
  }
  error(msg: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${msg}`, ...args);
  }
  debug(msg: string, ...args: unknown[]): void {
    console.debug(`[DEBUG] ${msg}`, ...args);
  }
}

/**
 * Storage stand-in for contexts that did not declare the `storage`
 * capability. Mirrors Drop core's `guardStorage`: every method fails closed
 * with a capability error instead of silently reading or writing.
 */
function guardStorage(pluginId: string): PluginStorage {
  const deny = (operation: string): never => {
    throw new Error(
      `Plugin '${pluginId}' missing required capability 'storage' (${operation})`,
    );
  };
  return {
    get: async () => deny("storage.get"),
    set: async () => deny("storage.set"),
    delete: async () => deny("storage.delete"),
    listKeys: async () => deny("storage.listKeys"),
    getSchemaVersion: async () => deny("storage.getSchemaVersion"),
    setSchemaVersion: async () => deny("storage.setSchemaVersion"),
  };
}

export class MockPluginContext implements PluginContext {
  public id: string;
  public logger: PluginLogger;
  public storage: PluginStorage;
  public settings: Record<string, unknown>;
  public capabilities: Set<PluginCapability>;

  public routes = new Map<
    string,
    { method: HttpMethod; pattern: string; handler: RouteHandler }
  >();
  public wsHandlers = new Map<string, WebSocketHandler>();
  public eventListeners = new Map<string, Set<(event: unknown) => void>>();
  public authorizers: Array<{
    matches: (c: string) => boolean;
    auth: SubscriptionAuthorizer;
  }> = [];

  constructor(
    id: string,
    capabilities: PluginCapability[] = [
      "routes",
      "storage",
      "websocket",
      "events",
      "network",
    ],
    settings: Record<string, unknown> = {},
  ) {
    this.id = id;
    this.logger = new MockPluginLogger();
    this.capabilities = new Set(capabilities);
    this.settings = settings;
    this.storage = this.capabilities.has("storage")
      ? new MockPluginStorage()
      : guardStorage(id);
  }

  registerRoute(
    method: HttpMethod,
    pattern: string,
    handler: RouteHandler,
  ): void {
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

  public readonly publicChannels = new Set<string>();

  registerWebSocket(
    channel: string,
    handler: WebSocketHandler,
    options?: { public?: boolean },
  ): void {
    this.assertCapability("websocket");
    this.wsHandlers.set(channel, handler);
    if (options?.public) {
      this.publicChannels.add(channel);
    }
  }

  registerPublicWebSocketChannel(channel: string): void {
    this.assertCapability("websocket");
    this.publicChannels.add(channel);
  }

  isPublicChannel(channel: string): boolean {
    return this.publicChannels.has(channel);
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

  public metadataProviders = new Map<string, MetadataProvider>();
  public paymentGateways = new Map<string, PaymentGateway>();
  public cloudSaveResolvers = new Map<string, CloudSavePathResolver>();
  public authProviders = new Map<string, AuthProvider>();
  public depotProviders = new Map<string, DepotStorageProvider>();
  public scheduledTasks = new Map<
    string,
    { intervalMs: number; task: () => Promise<void> | void }
  >();

  registerMetadataProvider(provider: MetadataProvider): void {
    if (!provider || typeof provider.id !== "string" || !provider.id.trim()) {
      throw new Error("Metadata provider must have a valid non-empty id");
    }
    this.assertCapability("metadata:provider");
    const existing = this.metadataProviders.get(provider.id);
    if (existing && existing !== provider) {
      throw new Error(
        `Metadata provider '${provider.id}' is already registered`,
      );
    }
    this.metadataProviders.set(provider.id, provider);
  }

  registerPaymentGateway(gateway: PaymentGateway): void {
    if (!gateway || typeof gateway.id !== "string" || !gateway.id.trim()) {
      throw new Error("Payment gateway must have a valid non-empty id");
    }
    this.assertCapability("commerce:payment");
    const existing = this.paymentGateways.get(gateway.id);
    if (existing && existing !== gateway) {
      throw new Error(`Payment gateway '${gateway.id}' is already registered`);
    }
    this.paymentGateways.set(gateway.id, gateway);
  }

  registerCloudSaveResolver(resolver: CloudSavePathResolver): void {
    if (!resolver || typeof resolver.id !== "string" || !resolver.id.trim()) {
      throw new Error("Cloud save resolver must have a valid non-empty id");
    }
    this.assertCapability("cloudsave:provider");
    const existing = this.cloudSaveResolvers.get(resolver.id);
    if (existing && existing !== resolver) {
      throw new Error(
        `Cloud save resolver '${resolver.id}' is already registered`,
      );
    }
    this.cloudSaveResolvers.set(resolver.id, resolver);
  }

  registerAuthProvider(provider: AuthProvider): void {
    if (!provider || typeof provider.id !== "string" || !provider.id.trim()) {
      throw new Error("Auth provider must have a valid non-empty id");
    }
    this.assertCapability("auth:provider");
    const existing = this.authProviders.get(provider.id);
    if (existing && existing !== provider) {
      throw new Error(`Auth provider '${provider.id}' is already registered`);
    }
    this.authProviders.set(provider.id, provider);
  }

  registerDepotProvider(provider: DepotStorageProvider): void {
    if (!provider || typeof provider.id !== "string" || !provider.id.trim()) {
      throw new Error("Depot provider must have a valid non-empty id");
    }
    this.assertCapability("storage:depot");
    const existing = this.depotProviders.get(provider.id);
    if (existing && existing !== provider) {
      throw new Error(`Depot provider '${provider.id}' is already registered`);
    }
    this.depotProviders.set(provider.id, provider);
  }

  scheduleTask(
    name: string,
    intervalMs: number,
    task: () => Promise<void> | void,
  ): () => void {
    this.scheduledTasks.set(name, { intervalMs, task });
    return () => {
      this.scheduledTasks.delete(name);
    };
  }

  private assertCapability(cap: PluginCapability): void {
    if (!this.capabilities.has(cap)) {
      throw new Error(
        `Plugin '${this.id}' missing required capability '${cap}'`,
      );
    }
  }
}
