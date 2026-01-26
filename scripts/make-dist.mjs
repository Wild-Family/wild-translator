import { rm, mkdir, cp, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "extension-dist");

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

// Copy compiled background/content
await cp(path.join(root, "extension", "dist"), distDir, { recursive: true });

// Copy exported Next.js UI
const uiOut = path.join(root, "ui", "out");
if (!(await exists(uiOut))) {
  throw new Error("ui/out not found. Run `npm -w ui run build` first.");
}
await cp(uiOut, path.join(distDir, "ui"), { recursive: true });

console.log(`✅ extension-dist ready: ${distDir}`);
