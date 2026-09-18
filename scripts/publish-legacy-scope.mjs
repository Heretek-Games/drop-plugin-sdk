#!/usr/bin/env node
/* global process, console */

import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, symlinkSync, existsSync } from "node:fs";
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
const scopeArgIndex = args.indexOf("--scope");
const scope = scopeArgIndex >= 0 ? args[scopeArgIndex + 1] : LEGACY_SCOPE;

if (scope !== LEGACY_SCOPE && scope !== NEW_SCOPE) {
  console.error(`Unknown scope '${scope}' (expected ${LEGACY_SCOPE} or ${NEW_SCOPE})`);
  process.exit(1);
}

const targets = packageArg ? [packageArg] : Object.keys(PACKAGES);

if (!targets.every((name) => PACKAGES[name])) {
  console.error(`Unknown package(s) ${targets.filter((n) => !PACKAGES[n]).join(", ")}`);
  process.exit(1);
}

function rewriteSpecifiers(text) {
  return text
    .replaceAll(`${NEW_SCOPE}/plugin-sdk`, `${scope}/plugin-sdk`)
    .replaceAll(`${NEW_SCOPE}/plugin-cli`, `${scope}/plugin-cli`)
    .replaceAll(`${LEGACY_SCOPE}/plugin-sdk`, `${scope}/plugin-sdk`)
    .replaceAll(`${LEGACY_SCOPE}/plugin-cli`, `${scope}/plugin-cli`);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const stagingRoot = path.join(repoRoot, ".legacy-publish");
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });

function stagePackage(name) {
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
  for (const file of walk(staged)) {
    if (!/\.(js|mjs|cjs|json)$/.test(file)) continue;
    const before = readFileSync(file, "utf-8");
    if (!before.includes(NEW_SCOPE) && !before.includes(LEGACY_SCOPE)) continue;
    const after = rewriteSpecifiers(before);
    if (after !== before) writeFileSync(file, after);
  }
  const manifestPath = path.join(staged, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.name = `${scope}/${name}`;
  for (const depKey of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (!manifest[depKey]) continue;
    for (const dep of Object.keys(manifest[depKey])) {
      if (dep === `${NEW_SCOPE}/plugin-sdk` || dep === `${NEW_SCOPE}/plugin-cli` || dep === `${LEGACY_SCOPE}/plugin-sdk` || dep === `${LEGACY_SCOPE}/plugin-cli`) {
        const suffix = dep.slice(dep.indexOf("/"));
        const rawVersion = manifest[depKey][dep];
        delete manifest[depKey][dep];
        const siblingDir = suffix === "/plugin-sdk" ? PACKAGES["plugin-sdk"].dir : PACKAGES["plugin-cli"].dir;
        const concrete = rawVersion.startsWith("workspace:")
          ? JSON.parse(readFileSync(path.join(repoRoot, siblingDir, "package.json"), "utf-8")).version
          : rawVersion;
        manifest[depKey][`${scope}${suffix}`] = concrete;
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return staged;
}

for (const name of targets) {
  const pkg = PACKAGES[name];
  const staged = stagePackage(name);

  // Post-rewrite smoke testing: ensure staged artifacts pack cleanly and evaluate without errors
  execSync("npm pack --dry-run", { cwd: staged, stdio: "pipe" });
  if (name === "plugin-sdk") {
    execSync('node --input-type=module -e "import * as sdk from \'./dist/index.js\'; if (typeof sdk.PLUGIN_API_VERSION !== \'number\') process.exit(1);"', {
      cwd: staged,
      stdio: "pipe",
    });
  } else if (name === "plugin-cli") {
    const nodeModulesPath = path.join(staged, "node_modules");
    try {
      mkdirSync(nodeModulesPath, { recursive: true });
      const srcNodeModules = path.join(repoRoot, pkg.dir, "node_modules");
      for (const item of readdirSync(srcNodeModules)) {
        if (item === scope) continue;
        symlinkSync(path.join(srcNodeModules, item), path.join(nodeModulesPath, item), "junction");
      }
      // Stage the sibling SDK on demand: when plugin-cli is published in a
      // separate invocation the staging root no longer contains it, and the
      // smoke test must still be able to resolve the runtime dependency.
      const stagedSdkPath = path.join(stagingRoot, "plugin-sdk");
      if (!existsSync(stagedSdkPath)) stagePackage("plugin-sdk");
      const scopeDir = path.join(nodeModulesPath, scope);
      mkdirSync(scopeDir, { recursive: true });
      symlinkSync(stagedSdkPath, path.join(scopeDir, "plugin-sdk"), "junction");
      execSync('node --input-type=module -e "import * as cli from \'./dist/index.js\'; if (typeof cli.signPlugin !== \'function\') process.exit(1);"', {
        cwd: staged,
        stdio: "pipe",
      });
    } finally {
      rmSync(nodeModulesPath, { recursive: true, force: true });
    }
  }

  if (!dryRun) {
    const provenanceFlag = (args.includes("--provenance") || (process.env.GITHUB_ACTIONS === "true" && process.env.NPM_PROVENANCE === "true")) ? " --provenance" : "";
    execSync(`npm publish --access public${provenanceFlag}`, { cwd: staged, stdio: "inherit" });
  }
}

if (process.env.KEEP_STAGING !== "1") {
  rmSync(stagingRoot, { recursive: true, force: true });
}
console.log(dryRun ? `dry-run complete for ${scope}: ${targets.join(", ")}` : `publish complete for ${scope}: ${targets.join(", ")}`);
