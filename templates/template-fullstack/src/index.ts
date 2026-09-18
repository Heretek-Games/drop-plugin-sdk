import type { PluginContext, ServerPlugin } from "@drop-oss/plugin-sdk";

export interface StatusResponse {
  ok: boolean;
  version: string;
  synced: number;
}

export default class MyFullstackPlugin implements ServerPlugin {
  metadata = {
    id: "my-fullstack-plugin",
    name: "My Fullstack Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["server" as const, "client" as const],
    capabilities: [
      "routes" as const,
      "storage" as const,
      "network" as const,
      "events" as const,
    ],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info("Initializing fullstack plugin server entry...");

    ctx.registerRoute("GET", "/status", async (): Promise<StatusResponse> => {
      const synced = (await ctx.storage.get<number>("sync_count")) ?? 0;
      return { ok: true, version: this.metadata.version, synced };
    });

    // Requests are pre-parsed by the host: use `readJson()` (or `body`)
    // instead of importing h3 directly.
    ctx.registerRoute("POST", "/config", async (_event, route) => {
      const body = (await route.readJson?.<Record<string, unknown>>()) ?? route.body ?? {};
      await ctx.storage.set("last_config", body);
      const synced = ((await ctx.storage.get<number>("sync_count")) ?? 0) + 1;
      await ctx.storage.set("sync_count", synced);
      ctx.broadcast("config:updated", body);
      return { saved: true, synced };
    });
  }

  async teardown(): Promise<void> {
    // Cleanup hooks
  }
}
