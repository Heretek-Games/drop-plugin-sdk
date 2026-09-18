import path from "node:path";
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";

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
