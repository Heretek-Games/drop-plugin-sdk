import { spawn } from "node:child_process";
import path from "node:path";
import { readdir, stat } from "node:fs/promises";

async function directoryExists(dir: string): Promise<boolean> {
  return Boolean(await stat(dir).catch(() => null));
}

async function collectTestFiles(
  dir: string,
  extension: ".js" | ".ts",
): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries
    .filter(
      (entry): entry is string =>
        typeof entry === "string" &&
        (entry.endsWith(`.test${extension}`) ||
          entry.endsWith(`.spec${extension}`)),
    )
    .map((entry) => path.join(dir, entry));
}

export async function testPlugin(targetDir = "."): Promise<void> {
  const dir = path.resolve(process.cwd(), targetDir);

  const candidates = [
    path.join(dir, "dist", "test"),
    path.join(dir, "test"),
  ];

  let testFiles: string[] = [];
  for (const cand of candidates) {
    if (await directoryExists(cand)) {
      testFiles = await collectTestFiles(cand, ".js");
      if (testFiles.length > 0) break;
    }
  }

  if (testFiles.length === 0) {
    const testDir = path.join(dir, "test");
    if (await directoryExists(testDir)) {
      testFiles = await collectTestFiles(testDir, ".ts");
    }
  }

  if (testFiles.length === 0) {
    console.log(`No test files found in ${targetDir}`);
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...testFiles], {
      cwd: dir,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Tests exited with code ${code}`));
      }
    });
  });
}
