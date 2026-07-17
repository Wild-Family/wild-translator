import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(rootDir, "extension-dist");

async function readJson(relPath) {
  const filePath = path.join(rootDir, relPath);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function exists(relPath) {
  try {
    await access(path.join(rootDir, relPath));
    return true;
  } catch {
    return false;
  }
}

test("packaged layout matches manifest and static HTML references", async () => {
  const manifest = await readJson("extension/static/manifest.json");
  const distManifest = await readJson("extension-dist/manifest.json");

  const expectedFiles = [
    "extension-dist/manifest.json",
    "extension-dist/ui/popup/index.html",
    "extension-dist/ui/options/index.html",
    "extension-dist/ui/index.html",
    "extension-dist/ui/styles.css",
    "extension-dist/ui/src/index.js",
    "extension-dist/ui/src/popup/index.js",
    "extension-dist/ui/src/options/index.js",
    "extension-dist/extension/src/background.js",
  ];

  for (const relPath of expectedFiles) {
    assert.equal(await exists(relPath), true, `missing ${relPath}`);
  }

  assert.equal(await exists("extension-dist/extension/src/content.js"), false);
  assert.deepEqual(distManifest, manifest);
  assert.equal(manifest.action.default_popup, "ui/popup/index.html");
  assert.equal(manifest.options_page, "ui/options/index.html");
  assert.deepEqual(manifest.permissions, ["storage", "contextMenus"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://api.anthropic.com/*",
  ]);
  assert.equal(manifest.background.service_worker, "extension/src/background.js");
  assert.equal("content_scripts" in manifest, false);

  const indexHtml = await readFile(
    path.join(distDir, "ui/index.html"),
    "utf8",
  );
  assert.match(indexHtml, /<link rel="stylesheet" href="\.\/styles\.css" \/>/);
  assert.match(
    indexHtml,
    /<script type="module" src="\.\/src\/index\.js"><\/script>/,
  );
  assert.match(indexHtml, /id="theme-toggle"/);
  assert.match(indexHtml, /href="\.\/popup\/index\.html"/);
  assert.match(indexHtml, /href="\.\/options\/index\.html"/);

  const popupHtml = await readFile(
    path.join(distDir, "ui/popup/index.html"),
    "utf8",
  );
  assert.match(popupHtml, /<link rel="stylesheet" href="\.\.\/styles\.css" \/>/);
  assert.match(
    popupHtml,
    /<script type="module" src="\.\.\/src\/popup\/index\.js"><\/script>/,
  );
  assert.match(popupHtml, /id="popup-settings"/);
  assert.match(popupHtml, /id="popup-theme"/);
  assert.match(popupHtml, /id="popup-loading"/);
  assert.match(popupHtml, /id="popup-shell"/);
  assert.match(popupHtml, /id="popup-error"/);
  assert.match(popupHtml, /id="popup-prompt-select"/);
  assert.match(popupHtml, /id="popup-input"/);
  assert.match(popupHtml, /id="popup-run"/);
  assert.doesNotMatch(popupHtml, /popup-speech|Play English/);
  assert.match(popupHtml, /id="popup-output"/);
  assert.match(popupHtml, /width:\s*520px;/);
  assert.match(popupHtml, /height:\s*600px;/);

  const optionsHtml = await readFile(
    path.join(distDir, "ui/options/index.html"),
    "utf8",
  );
  assert.match(optionsHtml, /<link rel="stylesheet" href="\.\.\/styles\.css" \/>/);
  assert.match(
    optionsHtml,
    /<script type="module" src="\.\.\/src\/options\/index\.js"><\/script>/,
  );
  assert.match(optionsHtml, /id="loading"/);
  assert.match(optionsHtml, /id="content"/);
  assert.match(optionsHtml, /id="error-banner"/);
  assert.match(optionsHtml, /id="saved-banner"/);
  assert.match(optionsHtml, /id="prompt-select"/);
  assert.match(optionsHtml, /id="prompt-name"/);
  assert.match(optionsHtml, /id="prompt-template"/);
  assert.match(optionsHtml, /id="theme-button"/);
});
