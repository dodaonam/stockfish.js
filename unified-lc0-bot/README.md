# Unified LC0 Bot — Chess.com + Lichess

One Manifest V3 unpacked extension, one popup, one LC0 Native Messaging host and one local CPU LC0 engine for **both Chess.com and Lichess**.

This is a separate, personal-use integration of two known-good implementations:

- `lc0-bot-extension/` — Chess.com baseline.
- `lichess-bot-extension/` — Lichess baseline.

Both originals are intentionally untouched, so the new extension can be tested before replacing them.

## Functional parity

- Uses the original Chess.com DOM/game API adapter on its supported pages.
- Uses the original Lichess round WebSocket/bootstrap/FEN adapter, including move acknowledgement, on its supported pages.
- Keeps the same shared LC0 scheduler, search limits, random delay, keyboard shortcuts (`h`, `z`, `s`, `b`), floating control panel, highlight and Stockfish 17.1 evaluation logic.
- **Stockfish JS/WASM still downloads from the original CDN/GitHub Raw addresses when needed.** Nothing is bundled or pinned differently.
- Maintains independent stored site settings inside the unified extension: `platform.chesscom.*` and `platform.lichess.*`.
- One popup enables/disables the extension for the **currently active supported site**; changes broadcast to tabs from that site only.
- Uses a separate extension identity, page-event namespace, UI DOM namespace, and Native Messaging host from the two originals.

The only intended user-visible difference is the single shared extension entry in Brave/Chrome. Existing `chrome.storage.local` from the two standalone extension IDs cannot be read automatically; re-enter settings once in the unified installation.

## Ubuntu 22.04+ x86_64 / Brave or Google Chrome

From the repository root:

```bash
bash unified-lc0-bot/scripts/install-ubuntu.sh
```

The setup registers **`com.lc0bot.unifiedhost`** for Chrome and Brave and installs a small host/configuration under `~/.local/share/lc0unifiedbot/`.

The script first looks for a usable existing LC0 CPU executable and exactly one `.pb.gz` weight in:

1. `~/.local/share/lc0unifiedbot/engine/`
2. `~/.local/share/lc0bot/engine/` (existing Chess.com bot)
3. `~/.local/share/lc0lichessbot/engine/` (existing Lichess bot)

If one is found, it **reuses the engine without rebuilding or modifying its executable/weight**. If none exists, it builds the same pinned LC0 `v0.32.1` CPU/OpenBLAS engine as the standalone scripts, using `~/.cache/lc0unifiedbot`.

The installer still checks the included default `evilgyal-6.pb.gz` checksum before proceeding; it installs that network only when making a fresh engine.

Then in Brave/Chrome:

1. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**.
2. Select **Load unpacked**, choose `unified-lc0-bot/extension/`.
3. Disable the **original** LC0 Chess.com and Lichess extensions while testing on their corresponding sites, then reload those tabs. This avoids having two UI buttons and two independent engines operating on the same game.
4. Open Chess.com or Lichess in the active tab, click the unified popup and check **Local LC0 host is ready.**
5. Test board detection, manual analysis/highlighting, evaluation bar, and the existing automation settings in a controlled environment.

**Important:** Running the new install script does not remove or overwrite either old installation or its Native Messaging registration. Uninstalling original files or removing their weights is a separate user decision.

### Independent extension identity

This package has its own `manifest.key` and constant extension ID:

```text
fffphhehicejaoofboihaahcdjoomjck
```

Its Ubuntu and Windows installers explicitly register only that ID. Keep the `key` field unchanged and load the original `extension/` directory (not a copied, modified manifest).

### Changing the network

When the engine is reused, its network stays inside the corresponding existing engine folder. Keep exactly one `.pb.gz` file in the engine root/weights folder as required by the native host. This script does not migrate, delete or duplicate network files.

## Windows / Chrome or Brave

The single Windows installer uses the **same** local-CPU LC0 model as the original:

1. Supply the official CPU/oneDNN LC0 directory with `lc0.exe`, `dnnl.dll` and exactly one `.pb.gz` network.
2. Build the Native Host and Inno Setup package from `unified-lc0-bot`:

```powershell
.\packaging\windows\build-native-host.ps1
iscc "/DMyAppVersion=2026.10.30" packaging\windows\LC0Bot.iss
```

3. Run `LC0UnifiedBot-Setup-2026.10.30.exe`, choose the LC0 folder, then Load unpacked `unified-lc0-bot/extension/`.

Windows registers `com.lc0bot.unifiedhost` to this extension ID under the current user only. It does not touch the standalone installer identities.

## Implementation map

```text
unified-lc0-bot/
├── extension/
│   ├── adapters/
│   │   ├── chesscom-dom.js  (unchanged Chess.com domain mechanics)
│   │   └── lichess-dom.js   (unchanged Lichess round/socket mechanics)
│   ├── automation/scheduler.js
│   ├── core/{bridge-api,logger,state}.js
│   ├── engine/stockfish-eval.js
│   ├── ui/{control-panel,eval-bar,keyboard-shortcuts}.js
│   ├── {background,content,main-world,popup}.js
│   ├── popup.html
│   └── manifest.json
├── host/native_host.py
├── host/tests/test_native_host.py
├── tests/{adapter-chesscom,adapter-lichess,integration}.test.js
├── scripts/install-ubuntu.sh
├── packaging/windows/
└── assets/weights/evilgyal-6.pb.gz
```

Manifest injects the same isolated scripts for both domains, but only the appropriate adapter in the MAIN world, followed by the common `main-world.js` dispatcher. It preserves the original asynchronous Lichess move confirmation.

Site-specific UI mounting is contained in a small switch in the common control panel and evaluation bar: Chess.com uses its existing evaluation container; Lichess uses a separate bar beside `cg-board`. Neither site's adapter is replaced with the other's implementation.

## Verification

Run the dependency-free Node tests, Python host tests and Ubuntu shell syntax check:

```bash
node --test unified-lc0-bot/tests/*.test.js
python3 -m unittest discover -s unified-lc0-bot/host/tests -p 'test_*.py' -v
bash -n unified-lc0-bot/scripts/install-ubuntu.sh
```

The GitHub Actions workflow `.github/workflows/unified-lc0-checks.yml` runs these checks (including host tests on Windows). These are automated checks only; they do not replace testing in **real Brave/Chrome sessions** with the LC0 engine on both sites.

### Manual acceptance before merging

- [ ] Host status ready with only the unified Native Host installed.
- [ ] Chess.com parity: board state/FEN, orientation, side-to-move, highlights, automation, popup, evaluation and shortcuts.
- [ ] Lichess parity: same features plus round bootstrap, WebSocket confirmation, spectator/nonstandard-game guard.
- [ ] Per-site toggle/settings isolation after browser restart.
- [ ] Multiple tabs and both sites open simultaneously: no stale move applied to the wrong tab.
- [ ] Original installations remain untouched and usable after unified test is disabled.
- [ ] Windows installation and Chrome compatibility, if required.

## Responsible use

Browser automation and engine assistance can violate a chess service's fair-play rules, even when software is for personal use. Only use features in contexts explicitly allowed by each platform. This repo's personal-use status does not override the sites' rules.
