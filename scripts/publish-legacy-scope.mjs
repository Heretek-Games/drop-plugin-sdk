#!/usr/bin/env node

import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const LEGACY_SCOPE = "@droposs";
const packages = [
  { dir: "packages/plugin-sdk", name: "plugin-sdk" },
  { dir: "packages/plugin-cli", name: "plugin-cli" },
];
const dryRun = process.argv.includes("--dry-run");

rmSync(path.join(repoRoot, ".legacy-publish"), { recursive: true, force: true });
mkdirSync(path.join(repoRoot, ".legacy-publish"), { recursive: true });

for (const pkg of packages) {
  const staged = path.join(repoRoot, ".legacy-publish", pkg.name);
  cpSync(path.join(repoRoot, pkg.dir), staged, { recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(repoRoot, pkg.dir), src);
      if (rel.startsWith("node_modules") || rel.startsWith("dist/.") || rel.startsWith("tsconfig.") || rel.startsWith("src") || rel.startsWith("test")) return false;
      return true;
    },
  });
  const manifestPath = path.join(staged, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.name = `${LEGACY_SCOPE}/${pkg.name}`;
  manifest.repository = {
    type: "git",
    url: "git+https://github.com/Heretek-Games/drop-plugin-sdk.git",
    directory: `${pkg.dir}`,
  };
  for (const depKey of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (!manifest[depKey]) continue;
    for (const dep of Object.keys(manifest[depKey])) {
      if (dep === "@drop-oss/plugin-sdk" || dep === "@drop-oss/plugin-cli") {
        const version = manifest[dep];
        delete manifest[depKey][dep];
        manifest[depKey][`${LEGACY_SCOPE}/${dep.slice("@drop-oss/".length)}`] = version;
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (!dryRun) {
    execSync("npm publish --access public --provenance --no-git-checks", {
      cwd: staged,
      stdio: "inherit",
    });
  }
}

if (process.env.KEEP_STAGING !== "1") {
  rmSync(path.join(repoRoot, ".legacy-publish"), { recursive: true, force: true });
}
console.log(dryRun ? "dry-run complete" : "legacy-scope publish complete");
