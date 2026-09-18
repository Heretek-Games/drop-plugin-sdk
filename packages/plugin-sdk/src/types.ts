/**
 * Current plugin API version. Bump this when `PluginContext` or the manifest
 * contract changes incompatibly. Plugins declare the version they were built
 * against in `metadata.apiVersion`; mismatches are rejected at registration.
 */
export const PLUGIN_API_VERSION = 2;

/**
 * Plugin API versions Drop accepts at registration. `1` covers legacy
 * single-target bundles, `2` the universal server/client manifest. Declaring
 * an unsupported version (or omitting `apiVersion` entirely) fails closed.
 */
export const SUPPORTED_API_VERSIONS = [1, 2] as const;

/**
 * Current bundle signature scheme. `2` means `signature` covers the file
 * aggregate plus the canonical manifest (everything except `signature`).
 * Legacy bundles omit the marker and cover the file aggregate or, for
 * single-file bundles, the entry checksum only.
 */
export const SIGNATURE_VERSION = 2;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL";

export type PluginTarget = "server" | "client";

export type PluginCategory = "generic" | "metadata" | "storage" | "multiplayer";

export type ServerCapability =
  | "routes"
  | "storage"
  | "websocket"
  | "events"
  | "network"
  | "metadata:provider"
  | "commerce:payment"
  | "cloudsave:provider";

export type ClientCapability =
  | "ui:slot"
  | "ui:play-action"
  | "ui:context-menu"
  | "ui:sidebar"
  | "ui:topbar"
  | "game:launch-hook"
  | "game:fs"
  | "game:scan"
  | "client:storage"
  | "client:ws"
  | "system:sidecar"
  | "system:command"
  | "metadata:provider"
  | "client:library-scan"
  | "cloudsave:provider";

export type PluginCapability = ServerCapability | ClientCapability;

/**
 * Trust tier. Only `"trusted"` is supported today: plugins run in-process with
 * the server or client's own privileges. `"sandboxed"` is reserved for a future isolated
 * runtime and must be rejected until that runtime exists.
 */
export type PluginTrust = "trusted" | "sandboxed";

export type PluginStatus = "active" | "disabled" | "error" | "registered";

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  builtin?: boolean;
  /**
   * Plugin API version the plugin was built against. Required: Drop rejects
   * plugins that omit it rather than defaulting to the current version.
   * Supported values are `SUPPORTED_API_VERSIONS` (`1` and `2`).
   */
  apiVersion: number;
  /** Trust tier. Defaults to "trusted". */
  trust?: PluginTrust;
  /** Declared storage schema version; drives `migrateStorage`. */
  storageVersion?: number;
  category?: PluginCategory;
  targets?: PluginTarget[];
  capabilities?: PluginCapability[];
  enabled?: boolean;
}

export interface PluginManifest extends PluginMetadata {
  entry?: string;
  /**
   * Legacy alias for `client.entry`. Drop Desktop reads `client.entry`
   * (defaulting to `bundle.js`) and never consults this field, so new
   * manifests should declare the client entry inside the `client` block.
   */
  clientEntry?: string;
  /** SHA-256 of the entry file, hex. Verified before the bundle is imported. */
  checksum?: string;
  /**
   * SHA-256 of every file the bundle may import, keyed by path relative to the
   * bundle directory. Required for multi-file bundles so relative imports are
   * verified too. When present with `DROP_PLUGIN_SIGNING_KEY`, `signature`
   * covers the aggregate bundle digest rather than only the entry file.
   */
  files?: Record<string, string>;
  /**
   * Signature scheme marker. Signed bundles built by the current CLI carry
   * `SIGNATURE_VERSION` (2), meaning `signature` covers the file aggregate
   * plus the canonical manifest. Absent on legacy bundles, whose signature
   * covers the file aggregate or the entry checksum only.
   */
  signatureVersion?: number;
  /**
   * HMAC-SHA256 (hex) of the signature payload, keyed by
   * `DROP_PLUGIN_SIGNING_KEY`. Set `DROP_PLUGIN_REQUIRE_SIGNATURE=true` to
   * reject unsigned bundles.
   */
  signature?: string;

  // Universal v2 target declarations
  server?: {
    entry: string;
    /** TypeScript/JavaScript source the CLI bundles into `entry`. */
    source?: string;
    capabilities: ServerCapability[];
    storageVersion?: number;
  };
  client?: {
    entry: string;
    /** TypeScript/JavaScript source the CLI bundles into `entry`. */
    source?: string;
    css?: string;
    capabilities: ClientCapability[];
    slots?: Array<{ slot: UISlotName; component: string }>;
    /**
     * Bare executable names the client plugin may run via `ctx.system.run`
     * (requires the `system:command` capability). The desktop host rejects any
     * binary not listed here.
     */
    commands?: string[];
    /**
     * Optional native sidecar binaries shipped inside the plugin bundle and
     * staged by the desktop host at activation time. Each declared sidecar
     * `name` must also appear in `commands`; the host stages the target whose
     * `os`/`arch` match the current platform, verifies `sha256`, and resolves
     * the allowlisted bare name against the staged binary.
     */
    sidecars?: Sidecar[];
  };
}

/** One declared native sidecar executable bundled with the client plugin. */
export interface Sidecar {
  /** Bare executable name; must also be listed in `client.commands`. */
  name: string;
  /** Per-platform (and per-architecture) binaries for this sidecar. */
  targets: SidecarTarget[];
}

/** A platform-specific sidecar binary declared inside the plugin bundle. */
export interface SidecarTarget {
  /** Target operating system. */
  os: "linux" | "macos" | "windows";
  /** Target CPU architecture. */
  arch: "x64" | "arm64";
  /** Bundle-relative path to the binary (POSIX separators). */
  path: string;
  /** SHA-256 hex digest of the binary contents, verified by build, validate, and the hosts. */
  sha256: string;
}

export type PluginManifestV2 = PluginManifest;

export interface PluginStateRecord {
  enabled: boolean;
  updatedAt: number;
}

export interface RouteHandlerContext {
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  userId?: string;
  userAcls?: string[];
}

export type RouteHandler = (
  event: unknown,
  context: RouteHandlerContext,
) => unknown;

export interface PluginStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
  /** Declared/recorded schema version for `migrateStorage`. */
  getSchemaVersion(): Promise<number>;
  setSchemaVersion(version: number): Promise<void>;
}

export interface ClientPluginStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

/** Caller identity + reply sink for a plugin WebSocket message. */
export interface WebSocketContext {
  userId?: string;
  userAcls?: string[];
  send: (data: unknown) => void;
}

/** Caller identity available when authorizing a channel subscription. */
export interface SubscriptionContext {
  userId: string | undefined;
  userAcls: string[] | undefined;
}

/**
 * Authorize a client subscription to a channel. Returning `false` denies the
 * subscription; a channel with no matching authorizer is allowed (subject to
 * the gateway's authentication requirement).
 */
export type SubscriptionAuthorizer = (
  channel: string,
  context: SubscriptionContext,
) => Promise<boolean> | boolean;

export type WebSocketHandler = (
  message: unknown,
  context: WebSocketContext,
) => Promise<void> | void;

export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface WebSocketOptions {
  /**
   * If true, clients can subscribe to and receive broadcasts on this channel
   * without an authenticated user session (e.g. public game lobbies, server status).
   * Defaults to false.
   */
  public?: boolean;
}

export interface PluginContext {
  id: string;
  logger: PluginLogger;
  storage: PluginStorage;
  registerRoute(
    method: HttpMethod,
    pattern: string,
    handler: RouteHandler,
  ): void;
  broadcast(channel: string, event: unknown): void;
  subscribe(channel: string, listener: (event: unknown) => void): () => void;
  /**
   * Handle client messages on a WebSocket channel. Requires the `websocket`
   * capability. Channel names are global; a channel may only be claimed once.
   */
  registerWebSocket(
    channel: string,
    handler: WebSocketHandler,
    options?: WebSocketOptions,
  ): void;
  /**
   * Mark a channel as publicly readable without authentication.
   * Requires the `websocket` capability.
   */
  registerPublicWebSocketChannel(channel: string): void;
  /**
   * Gate client subscriptions to channels matching `matches`. Requires the
   * `websocket` capability. Channels with no matching authorizer stay open to
   * authenticated peers.
   */
  registerSubscriptionAuthorizer(
    matches: (channel: string) => boolean,
    authorize: SubscriptionAuthorizer,
  ): void;
  /** Network egress. Requires the `network` capability. */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  /**
   * Register a metadata provider SPI implementation.
   * Requires the `metadata:provider` capability.
   */
  registerMetadataProvider(provider: MetadataProvider): void;
  /**
   * Register a payment gateway SPI implementation.
   * Requires the `commerce:payment` capability.
   */
  registerPaymentGateway(gateway: PaymentGateway): void;
  /**
   * Register a cloud save path resolver SPI implementation.
   * Requires the `cloudsave:provider` capability.
   */
  registerCloudSaveResolver(resolver: CloudSavePathResolver): void;
}

export interface ServerPlugin {
  metadata: PluginMetadata;
  init(ctx: PluginContext): Promise<void> | void;
  teardown?(): Promise<void> | void;
  /**
   * Apply storage migrations when the recorded schema version is older than
   * `metadata.storageVersion`. `from` is exclusive, `to` inclusive.
   */
  migrateStorage?(
    from: number,
    to: number,
    storage: PluginStorage,
  ): Promise<void>;
}

// ==========================================
// Client Plugin Architecture (Playnite-inspired)
// ==========================================

export type UISlotName =
  | "game-detail:actions"
  | "game-detail:panels"
  | "game-detail:badges"
  | "settings:tabs"
  | "topbar:status"
  | "sidebar:nav"
  | "overlay:panel"
  | "overlay:quick-access";

export interface UISlotRegistration {
  slot: UISlotName;
  component: unknown;
  order?: number;
  label?: string;
  icon?: string;
}

/**
 * Playnite-inspired Play Action.
 * Injected dynamically by plugins to offer alternative game startup modes
 * (e.g. "Play Multiplayer", "Play Offline", "Launch with Reshade").
 */
export interface PlayAction {
  id: string;
  name: string;
  icon?: string;
  isDefault?: boolean;
  execute: (context: LaunchContext) => Promise<void> | void;
}

/**
 * Playnite-inspired Game Context Menu Item.
 * Injected into right-click menus on game items across the library.
 */
export interface GameMenuItem {
  id: string;
  label: string;
  icon?: string;
  execute: (gameId: string) => Promise<void> | void;
}

/**
 * Playnite-inspired Sidebar Item with optional real-time progress.
 */
export interface SidebarItem {
  id: string;
  title: string;
  icon?: string;
  type: "button" | "view";
  progressValue?: number; // 0 to 100, 0 hides bar
  activated?: () => void;
  component?: unknown;
}

/**
 * Playnite-inspired Top Bar Status Item.
 */
export interface TopBarItem {
  id: string;
  title: string;
  icon?: string;
  component?: unknown;
  activated?: () => void;
}

/**
 * Stages in the game launch pipeline.
 * Pre-launch stages are cancelable with automatic reverse rollback.
 */
export type LaunchStage =
  | "pre-launch:validate"
  | "pre-launch:prepare"
  | "pre-launch:stage"
  | "pre-launch:network"
  | "pre-launch:network-post"
  | "launch"
  | "post-exit:cleanup"
  | "post-exit:restore"
  | "post-exit:sync";

export interface LaunchContext {
  gameId: string;
  gameTitle: string;
  gameDir: string;
  actionId?: string;
  metadata?: Record<string, unknown>;
}

export interface LaunchHook {
  stage: LaunchStage;
  order?: number;
  execute: (ctx: LaunchContext) => Promise<void> | void;
}

/**
 * Scoped filesystem access strictly confined to the active game directory.
 * Path traversal (`..`) and symlink escapes outside the target root are rejected.
 */
export interface ScopedGameFs {
  readFile(gameId: string, relativePath: string): Promise<Uint8Array>;
  writeFile(
    gameId: string,
    relativePath: string,
    data: Uint8Array | string,
  ): Promise<void>;
  /**
   * Copy a game file to `<relativePath>.drop-backup` inside the game
   * directory. Resolves to the backup's path relative to the game root.
   */
  backupFile(gameId: string, relativePath: string): Promise<string>;
  /**
   * Restore `<relativePath>` from its `.drop-backup` copy and remove the
   * backup. Rejects when no backup exists.
   */
  restoreFile(gameId: string, relativePath: string): Promise<void>;
  fileExists(gameId: string, relativePath: string): Promise<boolean>;
  deleteFile(gameId: string, relativePath: string): Promise<void>;
}

export interface ScopedGameScanner {
  scanExecutables(
    gameId: string,
  ): Promise<Array<{ relativePath: string; sha256: string; size: number }>>;
  /**
   * Returns the relative paths of installed files whose path contains any of
   * the supplied patterns (case-insensitive). The host is deliberately agnostic
   * about what the patterns mean, so plugins own domain knowledge such as
   * anti-cheat or compatibility-tool detection.
   */
  findFiles(gameId: string, patterns: string[]): Promise<string[]>;
}

export interface ClientPluginWebSocket {
  send(channel: string, data: unknown): Promise<unknown>;
  subscribe(channel: string, listener: (data: unknown) => void): () => void;
}

/** Result of a native command run through the client host. */
export interface CommandResult {
  /** Process exit code. Non-zero indicates failure. */
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  /** Working directory for the process. */
  cwd?: string;
  /** Hard timeout in milliseconds; the host kills the process when exceeded. */
  timeoutMs?: number;
}

/**
 * Native command execution for client plugins.
 *
 * The host runs the binary directly (no shell) and enforces a per-plugin
 * allowlist declared in the manifest (`client.commands`). Binaries that are
 * not allowlisted are rejected; shell metacharacters are never interpreted.
 */
export interface ClientPluginSystem {
  run(
    bin: string,
    args?: string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

export interface ClientPluginContext {
  id: string;
  logger: PluginLogger;
  storage: ClientPluginStorage;
  registerSlot(
    slot: UISlotName,
    component: unknown,
    options?: { order?: number; label?: string; icon?: string },
  ): void;
  registerPlayAction(
    provider: (gameId: string) => Promise<PlayAction[]> | PlayAction[],
  ): () => void;
  registerGameMenuItem(item: GameMenuItem): () => void;
  registerSidebarItem(item: SidebarItem): () => void;
  registerTopBarItem(item: TopBarItem): () => void;
  registerLaunchHook(hook: LaunchHook): () => void;
  /**
   * Register a store library scanner SPI implementation.
   * Requires the `client:library-scan` capability.
   */
  registerStoreScanner(scanner: StoreScanner): () => void;
  /**
   * Register a client-side metadata provider SPI implementation.
   * Requires the `metadata:provider` capability.
   */
  registerMetadataProvider?(provider: MetadataProvider): () => void;
  /**
   * Register a client-side cloud save path resolver SPI implementation.
   * Requires the `cloudsave:provider` capability.
   */
  registerCloudSaveResolver?(resolver: CloudSavePathResolver): () => void;
  gameFs: ScopedGameFs;
  gameScanner: ScopedGameScanner;
  serverWs: ClientPluginWebSocket;
  /** Native command execution. Requires the `system:command` capability. */
  system: ClientPluginSystem;
  /**
   * Call this plugin's own server-side REST routes through the desktop host.
   *
   * The Tauri webview cannot reach the Drop server directly (TLS/auth), so the
   * host proxies the request and returns the decoded JSON response. `path` is
   * relative to `/api/v1/plugins/<pluginId>` (e.g. `"/rooms"`).
   */
  serverRequest<T = unknown>(
    method: HttpMethod,
    path?: string,
    body?: unknown,
  ): Promise<T>;
}

export interface ClientPlugin {
  metadata?: PluginMetadata;
  init(ctx: ClientPluginContext): Promise<void> | void;
  teardown?(): Promise<void> | void;
}

export interface FullstackPlugin {
  server?: ServerPlugin;
  client?: ClientPlugin;
}

// Specialized Plugin Contracts (Playnite-inspired)
export interface MetadataPlugin extends ClientPlugin {
  getGameMetadata?(
    gameId: string,
    fingerprint: string,
  ): Promise<Record<string, unknown> | null>;
}

export interface StoragePlugin extends ClientPlugin {
  getDepotStatus?(depotId: string): Promise<Record<string, unknown> | null>;
}

export interface MultiplayerPlugin extends ClientPlugin {
  getActiveRoom?(gameId: string): Promise<Record<string, unknown> | null>;
}

export type GenericPlugin = ClientPlugin;

// ==========================================
// Metadata Provider SPI (#7, #206, #207, #477)
// ==========================================

export interface MetadataSearchResult {
  id: string;
  title: string;
  releaseYear?: number;
  coverUrl?: string;
  bannerUrl?: string;
  iconUrl?: string;
  description?: string;
  provider: string;
}

export interface MetadataDetails extends MetadataSearchResult {
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  screenshots?: string[];
  metadata?: Record<string, unknown>;
}

export interface MetadataProvider {
  id: string;
  name: string;
  search(query: string): Promise<MetadataSearchResult[]>;
  getDetails(id: string): Promise<MetadataDetails | null>;
}

// ==========================================
// Store Scanner SPI (#21)
// ==========================================

export interface ScannedGame {
  externalId: string;
  store: "steam" | "gog" | "epic" | (string & {});
  title: string;
  installPath: string;
  executablePath?: string;
  iconUrl?: string;
  version?: string;
}

export interface StoreScanner {
  id: string;
  name: string;
  store: string;
  scan(): Promise<ScannedGame[]>;
  launch?(externalId: string): Promise<void>;
}

// ==========================================
// Payment Gateway SPI (#21)
// ==========================================

export interface PaymentIntentRequest {
  orderId: string;
  amount: number; // minor units (e.g. cents)
  currency: string;
  customerEmail?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentIntentResult {
  intentId: string;
  clientSecret?: string;
  checkoutUrl?: string;
  status: "pending" | "succeeded" | "failed";
}

export interface PaymentWebhookResult {
  orderId: string;
  status: "succeeded" | "failed" | "refunded";
  transactionId: string;
  payload?: Record<string, unknown>;
}

export interface PaymentGateway {
  id: string;
  name: string;
  createPaymentIntent(req: PaymentIntentRequest): Promise<PaymentIntentResult>;
  handleWebhook(
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<PaymentWebhookResult>;
}

// ==========================================
// Cloud Save Provider SPI (#9)
// ==========================================

export interface CloudSavePattern {
  pattern: string;
  platform?: "windows" | "linux" | "macos";
  winePrefix?: boolean;
}

export interface GameInstallContext {
  gameId: string;
  gameTitle: string;
  installDir?: string;
  winePrefix?: string;
  executableName?: string;
}

export interface CloudSavePathResolver {
  id: string;
  name: string;
  resolveSavePaths(
    gameContext: GameInstallContext,
  ): Promise<CloudSavePattern[]>;
}
