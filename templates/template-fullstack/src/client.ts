import type { ClientPlugin, ClientPluginContext } from "@drop-oss/plugin-sdk";
// @ts-expect-error Vue SFC import
import StatusPanel from "./components/StatusPanel.vue";

export default class MyFullstackClientPlugin implements ClientPlugin {
  metadata = {
    id: "my-fullstack-plugin",
    name: "My Fullstack Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: ["ui:slot" as const, "client:storage" as const],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.logger.info("Initializing fullstack plugin client entry...");

    ctx.registerSlot("game-detail:panels", StatusPanel, {
      label: "Sync Status",
      order: 20,
    });

    await ctx.storage.set("client_initialized", true);
  }

  async teardown(): Promise<void> {
    // Cleanup hooks
  }
}
