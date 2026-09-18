import type {
  MetadataDetails,
  MetadataProvider,
  MetadataSearchResult,
  PluginContext,
  ServerPlugin,
} from "@drop-oss/plugin-sdk";

export class ExampleMetadataProvider implements MetadataProvider {
  id = "example-metadata";
  name = "Example Metadata Provider";

  async search(query: string): Promise<MetadataSearchResult[]> {
    if (!query.trim()) return [];
    return [
      {
        id: "game-101",
        title: query,
        releaseYear: 2024,
        provider: this.id,
        description: `Search result for ${query}`,
        coverUrl: "https://example.com/cover.jpg",
      },
    ];
  }

  async getDetails(id: string): Promise<MetadataDetails | null> {
    if (id !== "game-101") return null;
    return {
      id: "game-101",
      title: "Example Game",
      releaseYear: 2024,
      provider: this.id,
      description: "A detailed description of the example game.",
      genres: ["Action", "Adventure"],
      developers: ["Independent Studio"],
      publishers: ["Heretek Games"],
      coverUrl: "https://example.com/cover.jpg",
    };
  }
}

export default class MyMetadataPlugin implements ServerPlugin {
  metadata = {
    id: "my-metadata-plugin",
    name: "My Metadata Provider",
    version: "1.0.0",
    apiVersion: 2,
    targets: ["server" as const],
    capabilities: [
      "metadata:provider" as const,
      "network" as const,
      "storage" as const,
    ],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info("Initializing metadata provider plugin...");
    ctx.registerMetadataProvider(new ExampleMetadataProvider());
  }

  async teardown(): Promise<void> {
    // Cleanup hooks
  }
}
