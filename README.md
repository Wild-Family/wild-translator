# わいるどぱんち

AI translator browser extension (MV3) with a **popup UI**, large input/output areas, customizable prompt presets, and support for **OpenAI / Gemini / Claude**.

## Dev

```bash
npm install
npm run dev
```

This starts the Next.js UI dev server (useful for UI iteration).

## Build extension (unpacked)

```bash
npm run build
```

Outputs: `extension-dist/`

Load it in Chrome:
- `chrome://extensions`
- Enable **Developer mode**
- **Load unpacked** → select `wild-translator/extension-dist`

## Usage
- Click the extension icon to open the popup UI
- Set API keys in **Settings** (options page)
- Choose a prompt preset and run

## Shortcut
A command is registered (default `Ctrl+Shift+Y` / `Cmd+Shift+Y`) which opens the UI in a new tab.

## Notes
- Streaming is not implemented yet (non-streaming MVP).
- Selected-text capture via content script is stubbed.
