# Stockfish Web — Chess.com extension

This product is a **Manifest V3 Chrome/Brave extension** for supported Chess.com game pages. It runs the Stockfish 17.1 JavaScript/WebAssembly engine in a browser Web Worker, without a Python Native Messaging host or a Windows Setup installer.

## Requirements and installation

1. Download or clone this repository.
2. In Chrome or Brave, open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Select **this folder itself**: `apps/stockfish/chesscom-web/` (it contains `manifest.json`). Unlike the native products, there is no nested `extension/` directory.
4. Open a supported Chess.com `/play/` or `/game/` page and use the extension popup or in-page controls.

The browser must be able to fetch the Stockfish JS/WASM assets from the configured jsDelivr or GitHub Raw URLs. Those URLs currently depend on the repository-root `stockfish_engine/` directory. The upstream engine files are not packaged into the extension itself.

## Components

- `manifest.json`: extension permissions, supported URL patterns, entry points and icons.
- `background.js`, `bridge.js`, `content.js`: background and page-integration entry points.
- `core/`, `adapters/`, `automation/`: state, logging, Chess.com integration, timers and automation.
- `engine/stockfish.js`: starts and communicates with the browser Stockfish worker.
- `ui/`: control panel, evaluation bar and move-classification overlay.
- `popup.html`, `popup.js`, `icons/`: extension popup and visual assets.

The interface includes engine analysis, configurable search depth, an evaluation bar, and move classification where the current Chess.com page supports it. Website DOM/API changes can affect the integration.

## Development and verification

Edit the source in this directory, then reload the unpacked extension in `chrome://extensions` and refresh the Chess.com page. JavaScript files can be syntax-checked locally using `node --check`. This product currently has no separate automated unit-test suite; browser-level testing is required to validate its live page integration and remote engine fetches.

No native host, Stockfish Windows executable, Lc0 engine, PyInstaller or Inno Setup is needed for this browser-only product. It is not part of the three automated Windows Setup release workflows.

## Responsible use

Use engine assistance or automation only where permitted by the website, event and applicable fair-play rules. Do not use it to gain prohibited assistance in live competitive games.
