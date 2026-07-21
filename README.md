# わいるどぱんち

AI translator browser extension (MV3) with a **popup UI**, large input/output areas, customizable prompt presets, and support for **OpenAI / Gemini / Claude**.

## Dev

```bash
pnpm install
pnpm dev
```

`pnpm dev` now runs `tsc --watch` only. It typechecks and keeps the sources compiling, but it does not start a UI server or refresh `extension-dist/`.

For a full rebuild of the unpacked extension, run:

```bash
pnpm build
```

For test runs, `pnpm test` first rebuilds the project and then executes the Node standard test suite.

## Build extension (unpacked)

```bash
pnpm build
```

Outputs: `extension-dist/`

Load it in Chrome:
- `chrome://extensions`
- Enable **Developer mode**
- **Load unpacked** → select `wild-translator/extension-dist`

## Test

```bash
pnpm test
```

## Release

GitHub Releases are created by `.github/workflows/release.yml`.

1. Update both `package.json` and `extension/static/manifest.json` to the same numeric version.
2. Run `pnpm release:verify` and `pnpm test`.
3. Create and push a matching tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow builds `extension-dist/`, uploads `release/wild-punch-vX.Y.Z.zip` with `manifest.json` at the zip root, and attaches `release/SHA256SUMS` to the GitHub Release. Manual runs are also supported through **Actions → Release** with an existing `vX.Y.Z` tag. Reruns fail if that GitHub Release already exists; delete the existing release first when intentionally recreating it.

## Usage
- Click the extension icon to open the popup UI
- Set API keys in **Settings** (options page)
- Choose a prompt preset and run

## Custom base URL
Each provider has an optional **Base URL** field in **Settings → API Keys**. Leave
it empty to use the provider default:

- OpenAI: `https://api.openai.com/v1` (the `/chat/completions` path is appended)
- Gemini: `https://generativelanguage.googleapis.com`
- Claude: `https://api.anthropic.com`

Set a custom value to target an OpenAI-compatible gateway, a self-hosted proxy,
or a local model server (e.g. `http://localhost:11434/v1`). The default hosts are
covered by the manifest's `host_permissions`; a custom host triggers a one-time
permission prompt (declared via `optional_host_permissions`) the first time you
set it. If you dismiss that prompt, requests to that host may fail until access
is granted.

## Shortcut
A command is registered (default `Ctrl+Shift+Y` / `Cmd+Shift+Y`) which opens the UI in a new tab.

## Notes
- Streaming is not implemented yet (non-streaming MVP).
- Selected text can be sent through the context menu; the extension does not inject an always-on content script.
