import http from "node:http";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { buildPlugin } from "./builder.js";

export interface DevServerOptions {
  port?: number;
  host?: string;
  sign?: boolean;
}

export interface DevServerInstance {
  server: http.Server;
  port: number;
  url: string;
  manifestUrl: string;
  close: () => Promise<void>;
  stop: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export async function startDevServer(
  targetDir = ".",
  options: DevServerOptions = {},
): Promise<DevServerInstance> {
  const dir = path.resolve(process.cwd(), targetDir);
  const manifestPath = path.join(dir, "drop-plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  const port = options.port ?? 4567;
  const host = options.host ?? "localhost";

  // 1. Start incremental watch build
  const buildResult = await buildPlugin(dir, {
    watch: true,
    sign: options.sign ?? true,
  });

  // 2. Start HTTP static server with CORS
  const server = http.createServer(async (req, res) => {
    // CORS headers for Drop Desktop webview
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlPath = (req.url || "/").split("?")[0] || "/";
    const filePath = path.join(dir, urlPath);

    // Prevent directory traversal
    const rel = path.relative(dir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || fileStat.isDirectory()) {
      res.writeHead(404);
      res.end("File not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    try {
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  const manifestUrl = `${url}/drop-plugin.json`;
  const clientEntry = manifest.client?.entry ?? "dist/src/client.js";

  console.log(`[drop-plugin] Dev server running at ${url}/`);
  console.log(
    `[drop-plugin] Client bundle URL: ${url}/${clientEntry}`,
  );
  console.log(
    `[drop-plugin] In Drop Desktop, test this plugin via Extension Settings -> Load Dev Plugin:`,
  );
  console.log(`              ${url}/${clientEntry}`);
  console.log(`[drop-plugin] Watching for file changes... (Press Ctrl+C to stop)`);

  const close = async () => {
    if (buildResult.contexts) {
      for (const ctx of buildResult.contexts) {
        await ctx.dispose();
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    server,
    port: actualPort,
    url,
    manifestUrl,
    close,
    stop: close,
  };
}
