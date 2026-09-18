import path from "node:path";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  stat,
  readdir,
  realpath,
} from "node:fs/promises";

export type TemplateType =
  | "starter"
  | "client-ui"
  | "metadata"
  | "store"
  | "runner"
  | "fullstack";

export interface InitOptions {
  id?: string;
  name?: string;
  author?: string;
  template?: string;
}

/** npm scopes the templates may resolve the SDK/CLI from. */
const SDK_SCOPES = new Set(["@drop-oss", "@droposs", "@drop"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-package",
  "dist-packages",
]);
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
]);

interface SdkScopeConfig {
  sdk: string;
  sdkVersion: string;
  cliVersion: string;
}

function parseSdkScope(text: string): SdkScopeConfig | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const { sdk, sdkVersion, cliVersion } = parsed;
  if (
    typeof sdk !== "string" ||
    typeof sdkVersion !== "string" ||
    typeof cliVersion !== "string" ||
    !SDK_SCOPES.has(sdk)
  ) {
    return null;
  }
  return { sdk, sdkVersion, cliVersion };
}

function rewriteSpecifiers(text: string, scope: string): string {
  let out = text;
  for (const other of SDK_SCOPES) {
    if (other === scope) continue;
    out = out
      .replaceAll(`${other}/plugin-sdk`, `${scope}/plugin-sdk`)
      .replaceAll(`${other}/plugin-cli`, `${scope}/plugin-cli`);
  }
  return out;
}

function parseDepKind(dep: string): "plugin-sdk" | "plugin-cli" | null {
  if (dep.endsWith("/plugin-sdk")) return "plugin-sdk";
  if (dep.endsWith("/plugin-cli")) return "plugin-cli";
  return null;
}

function rewriteSection(
  section: Record<string, string>,
  config: SdkScopeConfig,
): void {
  for (const dep of Object.keys(section)) {
    const kind = parseDepKind(dep);
    if (!kind) continue;
    delete section[dep];
    section[`${config.sdk}/${kind}`] =
      kind === "plugin-sdk" ? config.sdkVersion : config.cliVersion;
  }
}

function rewritePackageDeps(text: string, config: SdkScopeConfig): string {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text);
  } catch {
    return text;
  }
  const sections = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  for (const sectionName of sections) {
    const section = pkg[sectionName] as Record<string, string> | undefined;
    if (section) {
      rewriteSection(section, config);
    }
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}

async function walkFiles(
  dir: string,
  files: string[] = [],
  visited = new Set<string>(),
): Promise<string[]> {
  const real = await realpath(dir).catch(() => dir);
  if (visited.has(real)) return files;
  visited.add(real);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, files, visited);
    else files.push(full);
  }
  return files;
}

/**
 * Rewrites a freshly copied template so its `@drop-oss` monorepo specifiers
 * and `workspace:*` dependencies point at the scope/version declared in the
 * template's `.sdk-scope.json`. Without this a scaffolded repo keeps
 * `workspace:*` and cannot install outside the SDK monorepo.
 */
export async function applySdkScope(targetPath: string): Promise<boolean> {
  const raw = await readFile(
    path.join(targetPath, ".sdk-scope.json"),
    "utf-8",
  ).catch(() => null);
  if (raw === null) return false;
  const config = parseSdkScope(raw);
  if (!config) return false;

  for (const file of await walkFiles(targetPath)) {
    if (path.basename(file).match(/lock\.(json|yaml|lockb)$/)) continue;
    if (!TEXT_EXT.has(path.extname(file))) continue;
    const before = await readFile(file, "utf-8");
    let after = rewriteSpecifiers(before, config.sdk);
    if (path.basename(file) === "package.json") {
      after = rewritePackageDeps(after, config);
    }
    if (after !== before) await writeFile(file, after);
  }
  return true;
}

export function resolveTemplateFolder(templateName: string = "starter"): string {
  const norm = templateName.replace(/^template-/, "").toLowerCase();
  switch (norm) {
    case "client-ui":
    case "ui":
    case "client":
      return "template-client-ui";
    case "metadata":
      return "template-metadata";
    case "store":
      return "template-store";
    case "runner":
      return "template-runner";
    case "fullstack":
    case "full":
      return "template-fullstack";
    case "starter":
    case "default":
      return "starter-plugin";
    default:
      throw new Error(
        `Unknown template "${templateName}". Available templates: starter, client-ui, metadata, store, runner, fullstack`,
      );
  }
}

export async function initPlugin(
  targetDir: string,
  options: InitOptions = {},
): Promise<{ targetPath: string; id: string }> {
  const targetPath = path.resolve(process.cwd(), targetDir);
  await mkdir(targetPath, { recursive: true });

  const folder = resolveTemplateFolder(options.template);

  const candidates = [
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../templates",
      folder,
    ),
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../templates",
      folder,
    ),
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../templates",
      folder,
    ),
    path.resolve(process.cwd(), "templates", folder),
  ];

  let templateDir: string | null = null;
  for (const cand of candidates) {
    if (await stat(cand).catch(() => null)) {
      templateDir = cand;
      break;
    }
  }

  if (!templateDir) {
    throw new Error(`Plugin template directory for "${folder}" not found`);
  }

  await cp(templateDir, targetPath, {
    recursive: true,
    filter: (src) => {
      const basename = path.basename(src);
      return basename !== "node_modules" && basename !== "dist";
    },
  });

  // Point the scaffolded repo at the configured npm scope/version instead of
  // the monorepo's `workspace:*` links.
  await applySdkScope(targetPath);

  const pluginId =
    options.id ||
    path
      .basename(targetPath)
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-");
  const pluginName = options.name || pluginId;

  // Update drop-plugin.json
  const manifestPath = path.join(targetPath, "drop-plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  manifest.id = pluginId;
  manifest.name = pluginName;
  if (options.author) manifest.author = options.author;
  delete manifest.checksum;
  delete manifest.files;
  delete manifest.signature;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // Update package.json
  const pkgPath = path.join(targetPath, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pkg.name = `drop-${pluginId}`;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  return { targetPath, id: pluginId };
}
