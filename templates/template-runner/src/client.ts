import type {
  ClientPlugin,
  ClientPluginContext,
  LaunchContext,
  LaunchOverrides,
  RunnerPlatform,
  RunnerProvider,
} from "@drop-oss/plugin-sdk";

export class ExampleRunnerProvider implements RunnerProvider {
  id = "example-runner";
  name = "Example Compatibility Runner";
  supportedPlatforms: RunnerPlatform[] = ["windows", "linux"];

  async detect(): Promise<{ available: boolean; version?: string }> {
    return { available: true, version: "1.0.0" };
  }

  async resolveLaunch(context: LaunchContext): Promise<LaunchOverrides> {
    return {
      wrapperBin: "example-runner",
      wrapperArgs: ["--game", context.gameId],
      environment: {
        RUNNER_DEBUG: "1",
      },
    };
  }
}

export default class MyRunnerPlugin implements ClientPlugin {
  metadata = {
    id: "my-runner-plugin",
    name: "My Compatibility Runner",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: [
      "game:runner" as const,
      "system:command" as const,
      "client:storage" as const,
    ],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.logger.info("Initializing compatibility runner plugin...");
    ctx.registerRunnerProvider?.(new ExampleRunnerProvider());
  }

  async teardown(): Promise<void> {
    // Teardown
  }
}
