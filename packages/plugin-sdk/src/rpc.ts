import type { ClientPluginWebSocket } from "./types.js";

export interface PluginRpcOptions {
  pluginId: string;
  baseUrl?: string;
  ws?: ClientPluginWebSocket;
}

/**
 * Typed RPC helper client for interacting with server plugin HTTP routes and WebSocket channels.
 */
export class PluginRpcClient {
  public readonly pluginId: string;
  public readonly baseUrl: string;
  private readonly ws?: ClientPluginWebSocket;

  constructor(options: PluginRpcOptions) {
    this.pluginId = options.pluginId;
    let baseUrl = options.baseUrl ?? "";
    while (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    this.baseUrl = baseUrl;
    this.ws = options.ws;
  }

  /**
   * Send an HTTP request to the server plugin's registered route.
   */
  async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${this.baseUrl}/api/v1/plugins/${this.pluginId}${cleanPath}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Plugin '${this.pluginId}' request to ${cleanPath} failed with HTTP ${response.status}: ${errorText}`,
      );
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  /**
   * Send a message to a plugin channel via WebSocket.
   */
  async sendWs<T = unknown>(channel: string, data: unknown): Promise<T> {
    if (!this.ws) {
      throw new Error(
        `WebSocket client not initialized for plugin '${this.pluginId}'`,
      );
    }
    return (await this.ws.send(channel, data)) as T;
  }

  /**
   * Subscribe to messages on a plugin channel via WebSocket.
   */
  subscribeWs(channel: string, listener: (data: unknown) => void): () => void {
    if (!this.ws) {
      throw new Error(
        `WebSocket client not initialized for plugin '${this.pluginId}'`,
      );
    }
    return this.ws.subscribe(channel, listener);
  }
}

export function createPluginRpcClient(
  options: PluginRpcOptions,
): PluginRpcClient {
  return new PluginRpcClient(options);
}
