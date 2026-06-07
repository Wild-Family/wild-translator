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

## Shortcut
A command is registered (default `Ctrl+Shift+Y` / `Cmd+Shift+Y`) which opens the UI in a new tab.

## Notes
- Streaming is not implemented yet (non-streaming MVP).
- Selected-text capture via content script is stubbed.
