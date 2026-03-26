import { rm, mkdir, cp, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "extension-dist");
const buildDir = path.join(root, "build");

async function exists(p) {
  try {
    await readdir(p);
    return true;
  } catch {
    return false;
  }
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

// Copy manifest + any static assets
await cp(path.join(root, "extension", "static"), distDir, { recursive: true });

// Copy compiled extension source tree.
await cp(path.join(buildDir, "extension", "src"), path.join(distDir, "extension", "src"), {
  recursive: true,
});

// Copy compiled shared modules used by the extension.
await cp(path.join(buildDir, "shared", "src"), path.join(distDir, "shared", "src"), {
  recursive: true,
});

// Copy static UI shell.
const uiStatic = path.join(root, "ui", "static");
if (!(await exists(uiStatic))) {
  throw new Error("ui/static not found.");
}
await cp(uiStatic, path.join(distDir, "ui"), { recursive: true });

// Copy compiled UI modules.
await cp(path.join(buildDir, "ui", "src"), path.join(distDir, "ui", "src"), {
  recursive: true,
});

console.log(`✅ extension-dist ready: ${distDir}`);
