import { spawn } from "node:child_process";
import path from "node:path";
import { readdir, stat } from "node:fs/promises";

export async function testPlugin(targetDir = "."): Promise<void> {
  const dir = path.resolve(process.cwd(), targetDir);

  const candidates = [
    path.join(dir, "dist", "test"),
    path.join(dir, "test"),
  ];

  let testFiles: string[] = [];
  for (const cand of candidates) {
    if (await stat(cand).catch(() => null)) {
      const files = await readdir(cand, { recursive: true });
      for (const f of files) {
        if (
          typeof f === "string" &&
          (f.endsWith(".test.js") || f.endsWith(".spec.js"))
        ) {
          testFiles.push(path.join(cand, f));
        }
      }
      if (testFiles.length > 0) break;
    }
  }

  if (testFiles.length === 0) {
    const testDir = path.join(dir, "test");
    if (await stat(testDir).catch(() => null)) {
      const files = await readdir(testDir, { recursive: true });
      testFiles = files
        .filter(
          (f): f is string =>
            typeof f === "string" &&
            (f.endsWith(".test.ts") || f.endsWith(".spec.ts")),
        )
        .map((f) => path.join(testDir, f));
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
