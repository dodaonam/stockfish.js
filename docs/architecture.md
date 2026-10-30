# Architecture

## Scope

This repository is a small **product-oriented modular monorepo**. Products are grouped by their **primary chess engine**, not by website:

- `apps/lc0/unified/`: Lc0, Chess.com + Lichess.
- `apps/lc0/chesscom/`: standalone Lc0, Chess.com.
- `apps/lc0/lichess/`: standalone Lc0, Lichess.
- `apps/stockfish/chesscom-web/`: Stockfish JavaScript/WebAssembly.
- `apps/stockfish/chesscom-native/`: native Stockfish through Chrome Native Messaging.

Each product is independently installed and maintained. Shared packages and a new JS bundler are intentionally **not** introduced; do not assume that duplicated files can be removed without preserving the independent product release contract.

## Unified LC0 data flow

```text
Chess.com or Lichess page
  → platform-specific adapter (MAIN world)
  ↔ custom-event request/response bridge (ISOLATED world)
  ↔ scheduler and settings
  ↔ background service worker
  ↔ Chrome/Brave Native Messaging (stdio-framed JSON)
  ↔ Python native host
  ↔ local Lc0 executable (UCI)
```

The browser's own Stockfish 17.1 JS/WASM evaluation worker runs separately to power the evaluation bar. Lc0 remains responsible for best-move search.

## Platform isolation

The unified extension injects its Chess.com and Lichess adapters only on their matching URLs. Shared settings are scoped to `platform.chesscom.*` and `platform.lichess.*` in Chrome storage; the popup toggles only the active supported platform. Main-world communication uses the `lc0u-page-request` / `lc0u-page-response` event namespace.

The Lichess adapter reconstructs full FEN from round/WebSocket data and includes spectator and nonstandard-game guards. The Chess.com adapter uses its site-specific game and board APIs.

## Installation boundaries

- `extension/` is the unpacked Chrome/Brave extension root (except the historical Stockfish Web package, whose existing root is already the extension).
- `host/` contains the native messaging implementation and focused tests.
- `packaging/windows/` contains Windows installer/build inputs where present.
- `scripts/` holds OS-specific setup and smoke checks.
- `tests/` holds product-specific tests.
- `assets/weights/` remains product-local so existing setup scripts retain a self-contained source tree.

Do not change `manifest.key`, fixed extension IDs, native host names, allowed origins, browser registry keys, UCI/Native Messaging protocol, or storage namespaces as part of a path-only refactor.

## Compatibility resource

`stockfish_engine/` intentionally stays at the repository root. Multiple extensions and legacy userscripts load its files via URLs containing that exact path. Moving the assets would be a separate versioned migration requiring URL compatibility checks.

## Product lifecycle

The two standalone Lc0 products remain first-class apps until their maintenance/release status is explicitly changed. `legacy/userscripts/` contains older Tampermonkey integrations only.
