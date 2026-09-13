#!/usr/bin/env node
import { signPlugin } from "../dist/signer.js";

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
    case "help":
    default:
      console.log(`Drop Plugin CLI (drop-plugin)

Usage:
  drop-plugin sign [dir]   Calculate SHA-256 digests and sign drop-plugin.json
  drop-plugin build        Compile plugin bundle
  drop-plugin test         Run plugin tests
`);
      break;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
