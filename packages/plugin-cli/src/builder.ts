import * as esbuild from "esbuild";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { signPlugin } from "./signer.js";

export interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
  sign?: boolean;
  signingKey?: string;
  /** Write derived manifest fields here instead of the source manifest. */
  outManifest?: string;
}

export async function buildPlugin(
  targetDir = ".",
  options: BuildOptions = {},
): Promise<{ serverBuilt: boolean; clientBuilt: boolean }> {
  const dir = path.resolve(process.cwd(), targetDir);
  const manifestPath = path.join(dir, "drop-plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  let serverBuilt = false;
  let clientBuilt = false;

  // 1. Build Server Entry if source exists
  const serverSourceCandidates = [
    manifest.server?.source,
    "src/index.ts",
    "src/index.js",
    "src/server.ts",
  ].filter(Boolean);

  let serverEntrySource: string | null = null;
  for (const candidate of serverSourceCandidates) {
    const p = path.join(dir, candidate);
    if (await stat(p).catch(() => null)) {
      serverEntrySource = p;
      break;
    }
  }

  const serverOutFile = path.resolve(
    dir,
    manifest.server?.entry ?? manifest.entry ?? "dist/src/index.js",
  );

  if (serverEntrySource) {
    await esbuild.build({
      entryPoints: [serverEntrySource],
      outfile: serverOutFile,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      sourcemap: options.sourcemap ?? true,
      minify: options.minify ?? false,
      external: [
        "@drop-oss/plugin-sdk",
        "@droposs/plugin-sdk",
        "@drop/plugin-sdk",
        "h3",
        "pino",
      ],
    });
    serverBuilt = true;
  }

  // 2. Build Client Entry if source exists
  const clientSourceCandidates = [
    manifest.client?.source,
    "src/client.ts",
    "src/client.js",
  ].filter(Boolean);

  let clientEntrySource: string | null = null;
  for (const candidate of clientSourceCandidates) {
    const p = path.join(dir, candidate);
    if (await stat(p).catch(() => null)) {
      clientEntrySource = p;
      break;
    }
  }

  const clientOutFile = path.resolve(
    dir,
    manifest.client?.entry ?? manifest.clientEntry ?? "dist/src/client.js",
  );

  if (clientEntrySource) {
    await esbuild.build({
      entryPoints: [clientEntrySource],
      outfile: clientOutFile,
      bundle: true,
      platform: "browser",
      target: "es2022",
      format: "esm",
      sourcemap: options.sourcemap ?? true,
      minify: options.minify ?? false,
      external: [
        "vue",
        "@drop-oss/plugin-sdk",
        "@droposs/plugin-sdk",
        "@drop/plugin-sdk",
      ],
    });
    clientBuilt = true;
  }

  // 3. Automatically re-sign the plugin bundle after building
  if (options.sign !== false) {
    await signPlugin(dir, options.signingKey, true, {
      outManifest: options.outManifest,
    });
  }

  return { serverBuilt, clientBuilt };
}
