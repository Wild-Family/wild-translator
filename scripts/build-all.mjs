import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const tscPath = path.join(root, "node_modules", "typescript", "bin", "tsc");
const contentScriptPath = path.join(root, "build", "extension", "src", "content.js");

await rm(path.join(root, "build"), { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscPath, "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// Manifest content_scripts run as classic scripts, so remove TS's module marker.
const contentScript = await readFile(contentScriptPath, "utf8");
await writeFile(
  contentScriptPath,
  contentScript.replace(/\nexport \{\};\s*$/u, "\n"),
);
