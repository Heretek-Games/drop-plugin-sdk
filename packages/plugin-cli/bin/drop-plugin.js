#!/usr/bin/env node
import {
  signPlugin,
  packPlugin,
  buildPlugin,
  testPlugin,
  initPlugin,
  validateManifest,
  verifyPlugin,
} from "../dist/index.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const command = process.argv[2];
const args = process.argv.slice(3);

async function runValidate(dir) {
  const manifestPath = path.join(
    path.resolve(process.cwd(), dir),
    "drop-plugin.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const validation = await validateManifest(manifest);
  if (!validation.valid) {
    console.error("Validation failed:");
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`Manifest at ${manifestPath} is valid.`);
}

function printUsage() {
  console.log(`Drop Plugin CLI (drop-plugin)

Usage:
  drop-plugin init [dir]         Initialize a new plugin from starter template
  drop-plugin build [dir]        Bundle server/client entry points with esbuild and sign
  drop-plugin sign [dir]         Calculate SHA-256 digests and sign drop-plugin.json
  drop-plugin verify [dir]       Verify checksums and signature of a bundle
                                 (--allow-unsigned accepts bundles without a signature)
  drop-plugin validate [dir]     Validate drop-plugin.json against official schema
  drop-plugin test [dir]         Run plugin tests with Node test runner
  drop-plugin pack [dir] [out]   Verify, sign, and package bundle into .dropplugin archive
`);
}

async function main() {
  switch (command) {
    case "sign": {
      const dir = args[0] || ".";
      const res = await signPlugin(dir);
      console.log(
        `Signed bundle at ${dir}: ${res.fileCount} files verified (signature: ${res.signed ? "yes" : "no"})`,
      );
      break;
    }
    case "pack": {
      const dir = args[0] || ".";
      const outDir = args[1];
      const res = await packPlugin(dir, outDir);
      console.log(
        `Packed plugin '${res.id}' v${res.version} to ${res.packagePath}`,
      );
      break;
    }
    case "build": {
      const dir = args[0] || ".";
      const res = await buildPlugin(dir);
      console.log(
        `Built plugin at ${dir} (server: ${res.serverBuilt ? "yes" : "no"}, client: ${res.clientBuilt ? "yes" : "no"})`,
      );
      break;
    }
    case "test": {
      const dir = args[0] || ".";
      await testPlugin(dir);
      break;
    }
    case "init": {
      const dir = args[0] || "my-drop-plugin";
      const res = await initPlugin(dir);
      console.log(
        `Initialized new Drop plugin '${res.id}' at ${res.targetPath}`,
      );
      break;
    }
    case "validate": {
      await runValidate(args[0] || ".");
      break;
    }
    case "verify": {
      const allowUnsigned = args.includes("--allow-unsigned");
      const dir = args.find((arg) => !arg.startsWith("-")) || ".";
      const res = await verifyPlugin(dir, undefined, { allowUnsigned });
      if (!res.valid) {
        console.error("Verification failed:");
        for (const err of res.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
      console.log(
        `Bundle at ${dir} is valid (signature: ${res.signed ? "verified" : "none"}).`,
      );
      break;
    }
    case "help":
    case "--help":
    case "-h":
    default: {
      printUsage();
      const isHelp =
        !command ||
        command === "help" ||
        command === "--help" ||
        command === "-h";
      if (!isHelp) {
        process.exit(1);
      }
      break;
    }
  }
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
