import { createHash, createHmac } from "node:crypto";
import {
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import Ajv from "ajv";

const MANIFEST_FILE = "drop-plugin.json";

export function isInside(base: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function loadSchema(): Promise<object> {
  try {
    const require = createRequire(import.meta.url);
    const schemaPath = require.resolve("@droposs/plugin-sdk/schema.json");
    return JSON.parse(await readFile(schemaPath, "utf-8"));
  } catch {
    const fallback = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../plugin-sdk/schema/drop-plugin.schema.json",
    );
    return JSON.parse(await readFile(fallback, "utf-8"));
  }
}

let cachedValidator: ((data: unknown) => boolean) | null = null;
let cachedErrors: string[] = [];

export async function validateManifest(
  manifest: unknown,
): Promise<{ valid: boolean; errors: string[] }> {
  if (!cachedValidator) {
    const schema = await loadSchema();
    // @ts-ignore
    const AjvClass = Ajv.default ?? Ajv;
    const ajv = new AjvClass({ allErrors: true, strict: false });
    const compiled = ajv.compile(schema);
    cachedValidator = (data: unknown) => {
      const ok = compiled(data);
      if (!ok && compiled.errors) {
        cachedErrors = compiled.errors.map(
          (err: any) => `${err.instancePath || "/"} ${err.message}`,
        );
      } else {
        cachedErrors = [];
      }
      return Boolean(ok);
    };
  }

  const valid = cachedValidator(manifest);
  return { valid, errors: [...cachedErrors] };
}

export async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const results: string[] = [];
  const dirPath = path.join(root, prefix);
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(root, rel);

    // Enforce confinement invariant: symlinks or traversal outside bundle root are rejected
    const real = await realpath(fullPath).catch(() => null);
    if (!real || !isInside(root, real)) {
      throw new Error(`Path traversal or symlink escape detected: ${rel}`);
    }

    const s = await stat(real);
    if (s.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      results.push(...(await listFiles(root, rel)));
    } else if (s.isFile()) {
      if (!prefix && entry.name === MANIFEST_FILE) continue;
      results.push(rel);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

export async function signPlugin(
  targetDir: string,
  signingKey?: string,
  validate = true,
): Promise<{ fileCount: number; signed: boolean }> {
  const resolvedPath = path.resolve(process.cwd(), targetDir);
  const bundleDir = await realpath(resolvedPath).catch(() => null);
  if (!bundleDir) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  const manifestPath = path.join(bundleDir, MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  if (validate) {
    const validation = await validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(
        `Manifest validation failed against schema:\n  ${validation.errors.join("\n  ")}`,
      );
    }
  }

  // Identify primary entry (v1 or v2 server/client entry)
  const entry =
    manifest.entry ??
    manifest.server?.entry ??
    manifest.client?.entry ??
    "index.js";
  const entryPath = path.resolve(bundleDir, entry);
  if (!isInside(bundleDir, entryPath) && entryPath !== bundleDir) {
    throw new Error(`Entry path outside bundle directory: ${entry}`);
  }

  const entryExists = await stat(entryPath).catch(() => null);
  if (entryExists) {
    const entryBytes = await readFile(entryPath);
    manifest.checksum = createHash("sha256").update(entryBytes).digest("hex");
  }

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

export async function packPlugin(
  targetDir: string,
  outputDir?: string,
): Promise<{ packagePath: string; id: string; version: string }> {
  const resolvedPath = path.resolve(process.cwd(), targetDir);
  const bundleDir = await realpath(resolvedPath).catch(() => null);
  if (!bundleDir) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  // Ensure bundle is signed and validated
  await signPlugin(bundleDir);

  const manifestPath = path.join(bundleDir, MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const id = manifest.id;
  const version = manifest.version;

  if (!id || !version) {
    throw new Error("Plugin manifest must specify 'id' and 'version'");
  }

  const outDir = outputDir
    ? path.resolve(process.cwd(), outputDir)
    : path.join(bundleDir, "dist-package");
  await mkdir(outDir, { recursive: true });

  const files = await listFiles(bundleDir);
  const bundleMap: Record<string, string> = {};

  for (const rel of files) {
    const content = await readFile(path.join(bundleDir, rel));
    bundleMap[rel] = content.toString("base64");
  }

  const packageObj = {
    format: "dropplugin-v2",
    id,
    version,
    manifest,
    files: bundleMap,
    packedAt: new Date().toISOString(),
  };

  const packagePath = path.join(outDir, `${id}-${version}.dropplugin`);
  await writeFile(packagePath, JSON.stringify(packageObj, null, 2), "utf-8");

  return { packagePath, id, version };
}
