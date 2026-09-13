import { createHash, createHmac } from "node:crypto";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MANIFEST_FILE = "drop-plugin.json";

function isInside(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

export async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      results.push(...(await listFiles(root, rel)));
    } else if (entry.isFile()) {
      if (!prefix && entry.name === MANIFEST_FILE) continue;
      results.push(rel);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

export async function signPlugin(targetDir: string, signingKey?: string): Promise<{ fileCount: number; signed: boolean }> {
  const resolvedPath = path.resolve(process.cwd(), targetDir);
  const bundleDir = await realpath(resolvedPath).catch(() => null);
  if (!bundleDir) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  const manifestPath = path.join(bundleDir, MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const entry = manifest.entry ?? "index.js";
  const entryPath = path.resolve(bundleDir, entry);
  const entryBytes = await readFile(entryPath);

  manifest.checksum = createHash("sha256").update(entryBytes).digest("hex");

  const files = await listFiles(bundleDir);
  const fileChecksums: Record<string, string> = {};
  const aggregate = createHash("sha256");

  for (const rel of files) {
    const bytes = await readFile(path.join(bundleDir, rel));
    fileChecksums[rel] = createHash("sha256").update(bytes).digest("hex");
    aggregate.update(rel);
    aggregate.update("\0");
    aggregate.update(String(bytes.length));
    aggregate.update("\0");
    aggregate.update(bytes);
  }
  manifest.files = fileChecksums;

  const key = signingKey ?? process.env.DROP_PLUGIN_SIGNING_KEY;
  if (key) {
    manifest.signature = createHmac("sha256", key)
      .update(aggregate.digest("hex"))
      .digest("hex");
  } else {
    delete manifest.signature;
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { fileCount: files.length, signed: Boolean(key) };
}
