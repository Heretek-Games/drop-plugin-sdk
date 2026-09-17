import type {
  ClientPlugin,
  ClientPluginContext,
  LaunchContext,
} from "@drop-oss/plugin-sdk";

export default class StarterClientPlugin implements ClientPlugin {
  metadata = {
    id: "starter-plugin",
    name: "Starter Plugin Client",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: [
      "ui:slot" as const,
      "ui:play-action" as const,
      "game:launch-hook" as const,
      "client:storage" as const,
    ],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.logger.info("Initializing starter plugin on desktop client...");

    // Register an injected UI panel on game detail pages.
    // Use a render function: production builds ship no Vue runtime template
    // compiler, so raw `template:` strings are rejected by the host.
    ctx.registerSlot(
      "game-detail:panels",
      {
        render() {
          const h = (globalThis as Record<string, any>).window?.Vue?.h;
          if (typeof h === "function") {
            return h(
              "div",
              {
                class:
                  "p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs text-zinc-300",
              },
              [
                h(
                  "span",
                  { class: "font-semibold text-purple-400" },
                  "Starter Plugin Panel:",
                ),
                " Injected into game-detail slot successfully.",
              ],
            );
          }
          return {
            type: "div",
            props: {
              class:
                "p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs text-zinc-300",
            },
            children: [
              {
                type: "span",
                props: { class: "font-semibold text-purple-400" },
                children: "Starter Plugin Panel:",
              },
              " Injected into game-detail slot successfully.",
            ],
          };
        },
      },
      { label: "Starter Status", order: 10 },
    );

    // Register a dynamic Play Action in the Play button dropdown
    ctx.registerPlayAction((_gameId: string) => [
      {
        id: "starter-quick-launch",
        name: "Launch with Starter Mode",
        icon: "heroicons:bolt",
        isDefault: false,
        execute: async (context: LaunchContext) => {
          ctx.logger.info(
            `Starter quick launch triggered for ${context.gameTitle}`,
          );
        },
      },
    ]);

    // Register a pre-launch hook to demonstrate the fail-closed launch pipeline
    ctx.registerLaunchHook({
      stage: "pre-launch:validate",
      order: 10,
      execute: async (context: LaunchContext) => {
        ctx.logger.info(
          `Running pre-launch check for game ${context.gameId}...`,
        );
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
