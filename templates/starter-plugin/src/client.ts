import type { ClientPlugin, ClientPluginContext, LaunchContext } from "@droposs/plugin-sdk";

export default class StarterClientPlugin implements ClientPlugin {
  metadata = {
    id: "starter-plugin",
    name: "Starter Plugin Client",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: [
      "ui:play-action" as const,
      "game:launch-hook" as const,
      "client:storage" as const,
    ],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.logger.info("Initializing starter plugin on desktop client...");

    // Register a dynamic Play Action in the Play button dropdown
    ctx.registerPlayAction((_gameId: string) => [
      {
        id: "starter-quick-launch",
        name: "Launch with Starter Mode",
        icon: "heroicons:bolt",
        isDefault: false,
        execute: async (context: LaunchContext) => {
          ctx.logger.info(`Starter quick launch triggered for ${context.gameTitle}`);
        },
      },
    ]);

    // Register a pre-launch hook to demonstrate the fail-closed launch pipeline
    ctx.registerLaunchHook({
      stage: "pre-launch:validate",
      order: 10,
      execute: async (context: LaunchContext) => {
        ctx.logger.info(`Running pre-launch check for game ${context.gameId}...`);
      },
    });

    // Save a client setting
    await ctx.storage.set("client_initialized", true);
    ctx.logger.info("Starter client plugin initialized successfully");
  }

  async teardown(): Promise<void> {
    // Cleanup hooks
  }
}
