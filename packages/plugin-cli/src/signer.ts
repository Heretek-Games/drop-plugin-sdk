import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
import { SIGNATURE_VERSION } from "@drop-oss/plugin-sdk";

const MANIFEST_FILE = "drop-plugin.json";

/** Current signature scheme; re-exported for backwards compatibility. */
export { SIGNATURE_VERSION };

/** Deterministic JSON so signer and verifier hash identical manifest bytes. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b, "en"));
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Whether a bundle-relative path is executable plugin code. */
function isBundleCodeFile(rel: string): boolean {
  const ext = path.extname(rel).toLowerCase();
  return ext === ".js" || ext === ".mjs" || ext === ".cjs";
}

/**
 * Aggregate digest over every bundle file, byte-compatible with the digest
 * `drop` core computes when verifying legacy signatures.
 */
async function computeFilesAggregate(
  bundleDir: string,
  files: string[],
): Promise<string> {
  const aggregate = createHash("sha256");
  for (const rel of files) {
    const bytes = await readFile(path.join(bundleDir, rel));
    aggregate.update(rel);
    aggregate.update("\0");
    aggregate.update(String(bytes.length));
    aggregate.update("\0");
    aggregate.update(bytes);
  }
  return aggregate.digest("hex");
}

/**
 * Signature payload v2: the files aggregate plus the canonical manifest
 * (excluding its `signature` field), so `id`, `version`, and `capabilities`
 * are covered and cannot be tampered with undetected. Shared algorithm with
 * `drop` core's verifier.
 */
export function signaturePayloadV2(
  filesAggregate: string,
  manifest: Record<string, unknown>,
): string {
  const { signature: _ignored, ...signable } = manifest;
  return createHash("sha256")
    .update(filesAggregate)
    .update("\0")
    .update(stableStringify(signable))
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function isInside(base: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function loadSchema(): Promise<object> {
  const require = createRequire(import.meta.url);
  for (const specifier of [
    "@drop-oss/plugin-sdk/schema.json",
    "@droposs/plugin-sdk/schema.json",
  ]) {
    try {
      return JSON.parse(await readFile(require.resolve(specifier), "utf-8"));
    } catch {
      // Try the next package scope before falling back to the monorepo path.
    }
  }
  const fallback = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../plugin-sdk/schema/drop-plugin.schema.json",
  );
  return JSON.parse(await readFile(fallback, "utf-8"));
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

export interface SignPluginOptions {
  /**
   * Write the derived manifest here instead of `<bundle>/drop-plugin.json`.
   * The source manifest is left untouched, so derived fields (checksum, files,
   * signature) can live only in a packaged artifact.
   */
  outManifest?: string;
}

/**
 * Compute the derived manifest (entry checksum, file checksums, signature)
 * without writing anything to disk.
 */
async function deriveManifest(
  bundleDir: string,
  manifest: Record<string, any>,
  signingKey?: string,
): Promise<{
  manifest: Record<string, any>;
  fileCount: number;
  signed: boolean;
}> {
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
    manifest.checksum = sha256Hex(entryBytes);
  }

  const files = await listFiles(bundleDir);
  const fileChecksums: Record<string, string> = {};

  for (const rel of files) {
    const bytes = await readFile(path.join(bundleDir, rel));
    fileChecksums[rel] = sha256Hex(bytes);
  }
  manifest.files = fileChecksums;

  const key = signingKey ?? process.env.DROP_PLUGIN_SIGNING_KEY;
  if (key) {
    manifest.signatureVersion = SIGNATURE_VERSION;
    const filesAggregate = await computeFilesAggregate(bundleDir, files);
    const payload = signaturePayloadV2(filesAggregate, manifest);
    manifest.signature = createHmac("sha256", key)
      .update(payload)
      .digest("hex");
  } else {
    delete manifest.signature;
    delete manifest.signatureVersion;
  }

  return { manifest, fileCount: files.length, signed: Boolean(key) };
}

export async function signPlugin(
  targetDir: string,
  signingKey?: string,
  validate = true,
  options: SignPluginOptions = {},
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
    const files = await listFiles(bundleDir);
    const present = new Set(files);
    const sidecarErrors: string[] = [];
    await verifySidecars(bundleDir, manifest, files, present, sidecarErrors);
    if (sidecarErrors.length > 0) {
      throw new Error(
        `Sidecar validation failed:\n  ${sidecarErrors.join("\n  ")}`,
      );
    }
  }

  const derived = await deriveManifest(bundleDir, manifest, signingKey);
  const outPath = options.outManifest
    ? path.resolve(process.cwd(), options.outManifest)
    : manifestPath;
  await writeFile(outPath, `${JSON.stringify(derived.manifest, null, 2)}\n`);
  return { fileCount: derived.fileCount, signed: derived.signed };
}

export interface VerifyResult {
  valid: boolean;
  signed: boolean;
  errors: string[];
}

/**
 * Verify a bundle against its shipped manifest: schema validity, per-file and
 * entry SHA-256 checksums, and (when present) the HMAC signature covering the
 * file aggregate plus the manifest itself.
 */
export async function verifyPlugin(
  targetDir: string,
  signingKey?: string,
  options: { allowUnsigned?: boolean } = {},
): Promise<VerifyResult> {
  const resolvedPath = path.resolve(process.cwd(), targetDir);
  const bundleDir = await realpath(resolvedPath).catch(() => null);
  if (!bundleDir) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  const manifestPath = path.join(bundleDir, MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const errors: string[] = [];

  const validation = await validateManifest(manifest);
  if (!validation.valid) {
    errors.push(...validation.errors.map((error) => `schema: ${error}`));
  }

  const declared: Record<string, string> | undefined = manifest.files;
  const files = await listFiles(bundleDir);
  const present = new Set(files);
  const codeFiles = files.filter(isBundleCodeFile);
  if (declared) {
    for (const rel of files) {
      const digest = sha256Hex(await readFile(path.join(bundleDir, rel)));
      if (declared[rel] !== digest) {
        errors.push(`checksum mismatch: ${rel}`);
      }
    }
    for (const rel of Object.keys(declared)) {
      const resolved = path.resolve(bundleDir, rel);
      if (path.isAbsolute(rel) || !isInside(bundleDir, resolved)) {
        errors.push(`invalid bundle file path: ${rel}`);
        continue;
      }
      if (!present.has(rel)) {
        errors.push(`declared file missing: ${rel}`);
      }
    }
    for (const rel of codeFiles) {
      if (!(rel in declared)) {
        errors.push(
          `bundle file '${rel}' is not covered by the manifest 'files' checksums`,
        );
      }
    }
  } else if (codeFiles.length > 1) {
    errors.push(
      "bundle contains multiple code files but no 'files' checksums; refusing unverified imports",
    );
  }

  const entry =
    manifest.entry ?? manifest.server?.entry ?? manifest.client?.entry;
  await verifySidecars(bundleDir, manifest, files, present, errors);
  if (entry) {
    const entryPath = path.resolve(bundleDir, entry);
    if (!isInside(bundleDir, entryPath)) {
      errors.push(`entry path outside bundle: ${entry}`);
    } else if (!(await stat(entryPath).catch(() => null))) {
      errors.push(`entry file missing: ${entry}`);
    } else if (manifest.checksum) {
      const digest = sha256Hex(await readFile(entryPath));
      if (digest !== manifest.checksum) {
        errors.push(`entry checksum mismatch: ${entry}`);
      }
    }
  }

  const key = signingKey ?? process.env.DROP_PLUGIN_SIGNING_KEY;
  let signed = false;
  if (manifest.signature) {
    if (!key) {
      errors.push("manifest is signed but no signing key is available");
    } else {
      const filesAggregate = await computeFilesAggregate(bundleDir, files);
      const resolved = await resolveSignedPayload(
        bundleDir,
        manifest,
        filesAggregate,
        entry,
      );
      if (resolved.payload === undefined) {
        errors.push(
          resolved.error ?? "unable to reconstruct signature payload",
        );
      } else {
        const expected = createHmac("sha256", key)
          .update(resolved.payload)
          .digest("hex");
        if (safeEqualHex(expected, manifest.signature)) {
          signed = true;
        } else {
          errors.push("signature verification failed");
        }
      }
    }
  } else if (!options.allowUnsigned) {
    errors.push(
      "bundle is unsigned (pass --allow-unsigned to accept unsigned bundles)",
    );
  }

  return { valid: errors.length === 0, signed, errors };
}

/**
 * Reconstruct the payload a signature covers, depending on the scheme:
 * v2 covers the file aggregate plus the canonical manifest; legacy bundles
 * cover the file aggregate, or the entry checksum for single-file bundles.
 */
async function resolveSignedPayload(
  bundleDir: string,
  manifest: Record<string, any>,
  filesAggregate: string,
  entry: string | undefined,
): Promise<{ payload?: string; error?: string }> {
  if (manifest.signatureVersion === SIGNATURE_VERSION) {
    if (!manifest.files) {
      return { error: "signatureVersion 2 requires manifest file checksums" };
    }
    return { payload: signaturePayloadV2(filesAggregate, manifest) };
  }
  if (manifest.signatureVersion !== undefined) {
    return {
      error: `unsupported signatureVersion: ${manifest.signatureVersion}`,
    };
  }
  if (manifest.files) {
    return { payload: filesAggregate };
  }
  if (manifest.checksum && entry) {
    return {
      payload: sha256Hex(await readFile(path.join(bundleDir, entry))),
    };
  }
  return {
    error: "legacy signature has neither file checksums nor an entry checksum",
  };
}

/**
 * Validate the `client.sidecars` declaration against the bundle contents:
 * each target path must resolve inside the bundle, point to a present regular
 * file covered by the `files` checksums, and cite a matching SHA-256 of the
 * binary. Every sidecar name must be allowlisted in `client.commands`, and
 */
export async function verifySidecars(
  bundleDir: string,
  manifest: Record<string, any>,
  files: string[],
  present: Set<string>,
  errors: string[],
): Promise<void> {
  const sidecars: unknown = manifest.client?.sidecars;
  if (sidecars === undefined) return;
  if (!Array.isArray(sidecars) || sidecars.length === 0) {
    errors.push("client.sidecars must be a non-empty array when declared");
    return;
  }

  const commands = new Set<string>(
    Array.isArray(manifest.client?.commands) ? manifest.client.commands : [],
  );
  for (const [idx, sidecar] of sidecars.entries()) {
    const label = `client.sidecars[${idx}]`;
    if (
      typeof sidecar !== "object" ||
      sidecar === null ||
      typeof (sidecar as Record<string, unknown>).name !== "string" ||
      !Array.isArray((sidecar as Record<string, unknown>).targets)
    ) {
      errors.push(`${label}: expected { name: string, targets: array }`);
      continue;
    }
    const { name, targets } = sidecar as {
      name: string;
      targets: Array<Record<string, unknown>>;
    };

    if (!commands.has(name)) {
      errors.push(
        `${label}: sidecar name '${name}' must be allowlisted in client.commands`,
      );
    }

    const seenTargets = new Set<string>();

    for (const [tIdx, target] of targets.entries()) {
      const tLabel = `${label}.targets[${tIdx}]`;
      if (!target || typeof target !== "object") {
        errors.push(`${tLabel}: expected target object`);
        continue;
      }
      if (typeof target.os !== "string" || typeof target.arch !== "string") {
        errors.push(`${tLabel}: expected string os and arch`);
        continue;
      }
      const key = `${target.os}-${target.arch}`;
      if (seenTargets.has(key)) {
        errors.push(
          `${tLabel}: duplicate target '${key}' (only one binary per os+arch for sidecar '${name}')`,
        );
        continue;
      }
      seenTargets.add(key);

      if (
        typeof target.path !== "string" ||
        path.isAbsolute(target.path) ||
        !isInside(bundleDir, path.resolve(bundleDir, target.path))
      ) {
        errors.push(`${tLabel}: path must be a bundle-relative path`);
        continue;
      }
      if (isBundleCodeFile(target.path)) {
        errors.push(
          `${tLabel}: 'sidecars' paths must not be JavaScript code files`,
        );
        continue;
      }
      if (!present.has(target.path)) {
        errors.push(`${tLabel}: declared sidecar file missing: ${target.path}`);
        continue;
      }
      const digest = sha256Hex(
        await readFile(path.join(bundleDir, target.path)),
      );
      if (target.sha256 !== digest) {
        errors.push(
          `${tLabel}: sha256 mismatch for ${target.path} (declared ${target.sha256}, actual ${digest})`,
        );
      }
    }
  }
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

  const manifestPath = path.join(bundleDir, MANIFEST_FILE);
  const rawManifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  const validation = await validateManifest(rawManifest);
  if (!validation.valid) {
    throw new Error(
      `Manifest validation failed against schema:\n  ${validation.errors.join("\n  ")}`,
    );
  }

  // Derive the signed manifest in memory: packing must not dirty the source
  // tree, the derived fields live in the archive only.
  const { manifest } = await deriveManifest(bundleDir, rawManifest);
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
