import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const tscPath = path.join(root, "node_modules", "typescript", "bin", "tsc");

await rm(path.join(root, "build"), { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscPath, "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
