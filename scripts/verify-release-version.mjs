import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isChromeExtensionVersion(version) {
  return /^\d+(?:\.\d+){0,3}$/.test(version);
}

async function readJson(relPath) {
  const raw = await readFile(path.join(root, relPath), "utf8");
  return JSON.parse(raw);
}

const pkg = await readJson("package.json");
const manifest = await readJson("extension/static/manifest.json");

if (pkg.version !== manifest.version) {
  fail(
    `Version mismatch: package.json has ${pkg.version}, extension/static/manifest.json has ${manifest.version}.`,
  );
}

if (!isChromeExtensionVersion(manifest.version)) {
  fail(
    `Invalid Chrome extension version "${manifest.version}". Use 1 to 4 dot-separated numeric parts.`,
  );
}

const releaseTag = process.env.RELEASE_TAG;
if (releaseTag) {
  const expectedTag = `v${pkg.version}`;
  if (releaseTag !== expectedTag) {
    fail(`Release tag mismatch: expected ${expectedTag}, got ${releaseTag}.`);
  }
}

console.log(`Release version verified: v${pkg.version}`);
