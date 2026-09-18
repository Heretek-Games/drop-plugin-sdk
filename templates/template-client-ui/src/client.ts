import type { ClientPlugin, ClientPluginContext } from "@drop-oss/plugin-sdk";
// @ts-expect-error Vue SFC import
import MyPanel from "./components/MyPanel.vue";

export default class MyClientUiPlugin implements ClientPlugin {
  metadata = {
    id: "my-client-ui-plugin",
    name: "My Client UI Plugin",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: ["ui:slot" as const, "client:storage" as const],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.logger.info("Initializing client UI plugin with Vue SFC...");

    // Injects the Vue 3 component into the game detail body
    ctx.registerSlot("game-detail:panels", MyPanel, {
      label: "Extension Panel",
      order: 10,
    });

    await ctx.storage.set("ui_plugin_loaded", true);
  }

  async teardown(): Promise<void> {
    // Teardown cleanup
  }
}
