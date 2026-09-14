import path from "node:path";
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";

export interface InitOptions {
  id?: string;
  name?: string;
  author?: string;
}

export async function initPlugin(
  targetDir: string,
  options: InitOptions = {},
): Promise<{ targetPath: string; id: string }> {
  const targetPath = path.resolve(process.cwd(), targetDir);
  await mkdir(targetPath, { recursive: true });

  const candidates = [
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../templates/starter-plugin"),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../templates/starter-plugin"),
    path.resolve(process.cwd(), "templates/starter-plugin"),
  ];

  let templateDir: string | null = null;
  for (const cand of candidates) {
    if (await stat(cand).catch(() => null)) {
      templateDir = cand;
      break;
    }
  }

  if (!templateDir) {
    throw new Error("Starter plugin template directory not found");
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
