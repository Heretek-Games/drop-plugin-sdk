#!/usr/bin/env node
import { signPlugin, packPlugin } from "../dist/signer.js";

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case "sign": {
      const dir = args[0] || ".";
      const res = await signPlugin(dir);
      console.log(`Signed bundle at ${dir}: ${res.fileCount} files verified (signature: ${res.signed ? "yes" : "no"})`);
      break;
    }
    case "pack": {
      const dir = args[0] || ".";
      const outDir = args[1];
      const res = await packPlugin(dir, outDir);
      console.log(`Packed plugin '${res.id}' v${res.version} to ${res.packagePath}`);
      break;
    }
    case "help":
    default:
      console.log(`Drop Plugin CLI (drop-plugin)

Usage:
  drop-plugin sign [dir]         Calculate SHA-256 digests and sign drop-plugin.json
  drop-plugin pack [dir] [out]   Verify, sign, and package bundle into .dropplugin archive
  drop-plugin build              Compile plugin bundle
  drop-plugin test               Run plugin tests
`);
      break;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
