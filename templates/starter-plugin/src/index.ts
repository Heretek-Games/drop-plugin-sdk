import type { PluginContext, ServerPlugin } from "@drop-oss/plugin-sdk";

export default class StarterPlugin implements ServerPlugin {
  metadata = {
    id: "starter-plugin",
    name: "Starter Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["server" as const, "client" as const],
    capabilities: ["routes" as const, "storage" as const, "events" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info("Initializing starter plugin on server...");

    // Register REST endpoint
    ctx.registerRoute("GET", "/ping", async () => {
      return { status: "ok", time: Date.now() };
    });

    // Test storage
    const runs = ((await ctx.storage.get<number>("run_count")) ?? 0) + 1;
    await ctx.storage.set("run_count", runs);
    ctx.logger.info(`Starter plugin initialized (run count: ${runs})`);
  }

  async teardown(): Promise<void> {
    // Cleanup hooks
  }
}
