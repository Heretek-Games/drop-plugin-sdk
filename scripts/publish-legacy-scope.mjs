#!/usr/bin/env node

import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const LEGACY_SCOPE = "@droposs";
const NEW_SCOPE = "@drop-oss";
const PACKAGES = {
  "plugin-sdk": {
    dir: "packages/plugin-sdk",
    skip: ["node_modules", "src", "test", "tsconfig.json", "tsconfig.typecheck.json", ".eslintcache"],
  },
  "plugin-cli": {
    dir: "packages/plugin-cli",
    skip: ["node_modules", "src", "test", "tsconfig.json", "tsconfig.typecheck.json", ".eslintcache"],
  },
};
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const packageArg = args.find((arg, index) => args[index - 1] === "--package");

const targets = packageArg ? [packageArg] : Object.keys(PACKAGES);

if (!targets.every((name) => PACKAGES[name])) {
  console.error(`Unknown package(s) ${targets.filter((n) => !PACKAGES[n]).join(", ")}`);
  process.exit(1);
}

const stagingRoot = path.join(repoRoot, ".legacy-publish");
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });

for (const name of targets) {
  const pkg = PACKAGES[name];
  const staged = path.join(stagingRoot, name);
  cpSync(path.join(repoRoot, pkg.dir), staged, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(repoRoot, pkg.dir), src);
      if (rel === "") return true;
      return !pkg.skip.some((skip) => skip === rel || rel.startsWith(path.join(skip, "/") || skip));
    },
  });
  const manifestPath = path.join(staged, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.name = `${LEGACY_SCOPE}/${name}`;
  for (const depKey of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (!manifest[depKey]) continue;
    for (const dep of Object.keys(manifest[depKey])) {
      if (dep.startsWith(NEW_SCOPE)) {
        const suffix = dep.slice(NEW_SCOPE.length);
        const rawVersion = manifest[depKey][dep];
        delete manifest[depKey][dep];
        const concrete = rawVersion.startsWith("workspace:")
          ? JSON.parse(readFileSync(path.join(repoRoot, PACKAGES[suffix === "/plugin-sdk" ? "plugin-sdk" : "plugin-cli"].dir, "package.json"), "utf-8")).version
          : rawVersion;
        manifest[depKey][`${LEGACY_SCOPE}${suffix}`] = concrete;
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (!dryRun) {
    execSync("npm publish --access public --no-git-checks", { cwd: staged, stdio: "inherit" });
  }
}

if (process.env.KEEP_STAGING !== "1") {
  rmSync(stagingRoot, { recursive: true, force: true });
}
console.log(dryRun ? `dry-run complete for ${targets.join(", ")}` : `legacy-scope publish complete for ${targets.join(", ")}`);
