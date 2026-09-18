import type {
  ClientPlugin,
  ClientPluginContext,
  ScannedGame,
  StoreScanner,
} from "@drop-oss/plugin-sdk";

export class ExampleStoreScanner implements StoreScanner {
  id = "example-store";
  name = "Example Store Scanner";
  store = "example";

  async scan(): Promise<ScannedGame[]> {
    return [
      {
        externalId: "ext-100",
        store: "example",
        title: "Example Scanned Game",
        installPath: "/games/example-game",
        executablePath: "game.exe",
        version: "1.0.0",
      },
    ];
  }

  async launch(externalId: string): Promise<void> {
    console.log(`Launching game from external store: ${externalId}`);
  }
}

export default class MyStorePlugin implements ClientPlugin {
  metadata = {
    id: "my-store-plugin",
    name: "My Store Library Scanner",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["client" as const],
    capabilities: [
      "client:library-scan" as const,
      "client:storage" as const,
      "system:command" as const,
    ],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.logger.info("Initializing store library scanner plugin...");
    ctx.registerStoreScanner(new ExampleStoreScanner());
  }

  async teardown(): Promise<void> {
    // Teardown
  }
}
