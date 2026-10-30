# Unified LC0 Bot — Chess.com + Lichess

One Manifest V3 unpacked extension, one popup, one LC0 Native Messaging host and one local CPU LC0 engine for **both Chess.com and Lichess**.

This is a separate, personal-use integration of two known-good implementations:

- `apps/lc0/chesscom/` — Chess.com baseline.
- `apps/lc0/lichess/` — Lichess baseline.

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
bash apps/lc0/unified/scripts/install-ubuntu.sh
```

The setup registers **`com.lc0bot.unifiedhost`** for Chrome and Brave and installs a small host/configuration under `~/.local/share/lc0unifiedbot/`.

The script first looks for a usable existing LC0 CPU executable and exactly one `.pb.gz` weight in:

1. `~/.local/share/lc0unifiedbot/engine/`
2. `~/.local/share/lc0bot/engine/` (existing Chess.com bot)
3. `~/.local/share/lc0lichessbot/engine/` (existing Lichess bot)

If one is found, it **reuses the engine without rebuilding or modifying its executable/weight**. If none exists, it builds the same pinned LC0 `v0.32.1` CPU/OpenBLAS engine as the standalone scripts, using `~/.cache/lc0unifiedbot`.

**Engine parity:** If you customized the two standalone installations with different LC0 networks or builds, the unified host cannot preserve both choices simultaneously: it uses the first valid engine in the priority list above. Compare the actual engine and weight used by each old bot before accepting parity; the default network committed in the three folders is identical.

The installer still checks the included default `evilgyal-6.pb.gz` checksum before proceeding; it installs that network only when making a fresh engine.

Then in Brave/Chrome:

1. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**.
2. Select **Load unpacked**, choose `apps/lc0/unified/extension/`.
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

## Windows 11 x64 / Google Chrome or Brave

**For users (no Python, Git, PyInstaller, or Inno Setup required):**

1. Download the repository ZIP from GitHub (or clone it) and extract the folder `apps/lc0/unified/extension/`. Keep its `manifest.json` and `key` unchanged so the extension ID remains stable.
2. **Separately** download and extract the official LC0 Windows CPU/oneDNN package from [Leela Chess Zero's releases](https://github.com/LeelaChessZero/lc0/releases). Choose the version that provides `lc0.exe` and `dnnl.dll`.
3. Put **exactly one** network `.pb.gz` in that LC0 directory or in its `weights/` subdirectory. The network can be supplied separately; it is **not bundled in Setup**.
4. Download the latest `LC0UnifiedBot-Setup-<version>.exe` from this repository's [GitHub Releases](https://github.com/dodaonam/stockfish.js/releases). The `lc0-unified-v*` tags identify **Unified** Windows Setup releases, distinct from the standalone installers. Verify the SHA-256 checksum against `SHA256SUMS.txt` if desired.
5. Run Setup without Administrator privileges. Choose the LC0 folder containing `lc0.exe`, `dnnl.dll`, and the single network. Setup checks these files, installs only the Unified Native Messaging host under the current user's local app-data folder, and registers it for **both Chrome and Brave**.
6. In `chrome://extensions` or `brave://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the downloaded `apps/lc0/unified/extension/` folder.
7. Reload the browser's supported game page and check the popup's **Local LC0 host is ready** status. A real LC0 calculation and browser integration still need separate verification.

Setup does **not** download, copy, compile, modify, or distribute LC0 engine binaries or networks. The supplied engine remains in the folder chosen by the user. Setup does not touch either standalone Native Host identity.

**For developers building the installer locally on Windows:**

```powershell
cd apps/lc0/unified
python packaging/windows/validate-release.py
./packaging/windows/build-native-host.ps1
iscc "/DMyAppVersion=2026.10.30.1" packaging/windows/LC0Bot.iss
python packaging/windows/validate-release.py --host dist/lc0-native-host.exe --setup dist/LC0UnifiedBot-Setup-2026.10.30.1.exe
```

The automated Windows Setup pipeline is `.github/workflows/release-lc0-unified.yml`. It runs **only on relevant pushes/merges into `main`**, never on pull requests or feature-branch pushes. The workflow builds the Native Host and Inno Setup executable on a Windows runner, checks the no-engine-bundling contract, generates `SHA256SUMS.txt`, and publishes a unique GitHub Release only after all build steps succeed. Each release points to the matching commit's extension source. Windows CI packaging validation does **not** replace a real installation and browser acceptance test.

## Implementation map

```text
apps/lc0/unified/
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
node --test apps/lc0/unified/tests/*.test.js
python3 -m unittest discover -s apps/lc0/unified/host/tests -p 'test_*.py' -v
bash -n apps/lc0/unified/scripts/install-ubuntu.sh
```

Automated test-only GitHub Actions have been removed. Adapter, integration, regression, and Native Host tests remain available locally using the commands above. Windows product build/Release validation runs separately on `main` only; successful packaging does **not** constitute real Windows installer or engine acceptance.

The popup's **Local LC0 host is ready** status verifies that host configuration, engine executable and a network file can be located; it does **not** execute a full UCI search. After installing on Ubuntu, run an actual local engine handshake and short calculation:

```bash
python3 apps/lc0/unified/scripts/smoke-engine.py
```

This checks the installed unified engine and weight without altering either standalone installation. It can take a little time on CPU and reports a best move on success.

These automated and CLI checks do not replace testing in **real Brave/Chrome sessions** with the LC0 engine on both sites.

### Manual acceptance before declaring end-to-end support

- [ ] Host status ready with only the unified Native Host installed.
- [ ] Chess.com parity: board state/FEN, orientation, side-to-move, highlights, automation, popup, evaluation and shortcuts.
- [ ] Lichess parity: same features plus round bootstrap, WebSocket confirmation, spectator/nonstandard-game guard.
- [ ] Fresh install and partially stored settings retain defaults: Move Time 0.01 s, Nodes 10000.
- [ ] Pressing `s` and `b` rapidly persists both changes; reopening the tab retains them.
- [ ] Disabling Auto Run while a request is in flight prevents its late result from executing a move.
- [ ] Per-site toggle/settings isolation after browser restart, and live same-site synchronization across tabs.
- [ ] Multiple tabs and both sites open simultaneously: no stale move applied to the wrong tab.
- [ ] Original installations remain untouched and usable after unified test is disabled.
- [ ] Windows 11 x64: clean install, upgrade, reinstall and uninstall; Brave and Chrome Native Messaging and real LC0 engine search on both sites; original standalone installations unaffected.

## Responsible use

Browser automation and engine assistance can violate a chess service's fair-play rules, even when software is for personal use. Only use features in contexts explicitly allowed by each platform. This repo's personal-use status does not override the sites' rules.
