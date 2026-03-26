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

## Usage
- Click the extension icon to open the popup UI
- Set API keys in **Settings** (options page)
- Choose a prompt preset and run

## Shortcut
A command is registered (default `Ctrl+Shift+Y` / `Cmd+Shift+Y`) which opens the UI in a new tab.

## Notes
- Streaming is not implemented yet (non-streaming MVP).
- Selected-text capture via content script is stubbed.
