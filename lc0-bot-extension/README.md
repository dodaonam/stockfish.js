# LC0 Bot for Windows and Ubuntu

LC0 Bot is a Manifest V3 extension installed with **Load unpacked**. It reads a Chess.com position and sends it to a local Lc0 CPU engine through Chrome/Brave Native Messaging.

```text
Chess.com → extension → Native Messaging host → Lc0 CPU engine
```

The JavaScript extension is shared by Windows and Ubuntu. The Native host is installed separately on each computer. The extension does not download or install itself from a browser store.

## Supported setups

- Windows x64 with Google Chrome or Brave, plus the official Windows CPU/oneDNN Lc0 package supplied by the user.
- Ubuntu 22.04 or newer, x86_64, with Google Chrome or Brave.
- Ubuntu installation builds Lc0 `v0.32.1` locally with the CPU BLAS/OpenBLAS backend. The install script does not distribute a prebuilt Lc0 binary.
- The included default network is `assets/weights/evilgyal-6.pb.gz`. Keep exactly one `.pb.gz` file in the active engine weight directory; users can replace the default with another network.

## Install on Windows

1. Download and extract the official Lc0 Windows CPU/oneDNN package. Keep `lc0.exe`, `dnnl.dll`, and exactly one `.pb.gz` network in the folder or its `weights/` subfolder. If you need the included default network, copy `assets/weights/evilgyal-6.pb.gz` into the Lc0 folder or its `weights/` subfolder.
2. Run `LC0Bot-Setup-YYYY.MM.DD.exe` and select the extracted Lc0 folder. Setup installs the Native host for the current Windows user and registers it for Chrome and Brave.
3. Open `chrome://extensions` in Chrome or Brave, enable **Developer mode**, choose **Load unpacked**, and select `lc0-bot-extension/extension/`.
4. Open the LC0 Bot popup. `Local LC0 host is ready.` means the host configuration, engine files, and network were found.

## Install on Ubuntu

From a terminal opened in this repository, run:

```bash
bash lc0-bot-extension/scripts/install-ubuntu.sh
```

The script checks for Ubuntu 22.04+ x86_64, installs missing build dependencies with `apt` (asking for `sudo` only for that system-package step), clones the pinned Lc0 source tag with its submodule, and builds the CPU/OpenBLAS engine. The first build needs an internet connection and may take several minutes. The source/build cache is kept under `~/.cache/lc0bot/`; the installed engine, host, configuration, and default network are kept under `~/.local/share/lc0bot/`.

After the script reports success:

1. Open `chrome://extensions` in Chrome or Brave, enable **Developer mode**, choose **Load unpacked**, and select `lc0-bot-extension/extension/`.
2. Open a supported Chess.com page. The popup should report `Local LC0 host is ready.`

The script registers the host for Google Chrome and Brave. If source checkout, dependency installation, or engine compilation fails, it stops before registering the manifests.

## Change the network

Keep exactly one `.pb.gz` file in the active engine's root or `weights/` folder.

- **Windows:** replace the existing network in the Lc0 folder or `weights/`.
- **Ubuntu:** replace the network under `~/.local/share/lc0bot/engine/weights/`.

The Ubuntu install script preserves an existing user network when run again. To apply a changed network, reload the extension in `chrome://extensions` and reload the Chess.com tab. If the popup reports multiple networks, leave only the network you want to use.

## Use and search settings

On a supported Chess.com page, the green **LC0** button opens settings for Auto Run, Auto Move, search mode (`Move Time` or `Nodes`), search limit, and random delay.

`Move Time` sends `go movetime <milliseconds>` to Lc0. `Nodes` sends `go nodes <number>` and is limited to 1–10000. Nodes are a search budget, not a fixed conversion to real time.

## Troubleshooting

- If the popup says the host is unavailable, run the platform setup again and read its full error message.
- On Windows, the selected folder must still contain `lc0.exe`, `dnnl.dll`, and exactly one network.
- On Ubuntu, confirm the script completed, `~/.local/share/lc0bot/engine/lc0` is executable, and exactly one network exists in its `weights/` folder.
- If a build fails, keep the output and rerun the script after resolving the named missing package or compiler error. The script reuses the pinned source and Meson build directory.
- On Ubuntu, use Google Chrome or Brave; the installer registers Native Messaging for these browsers.

## Development and release

The extension source remains in `extension/`. Reload the unpacked extension in `chrome://extensions` after changing extension files, then reload the Chess.com tab.

To build the Windows Native host and Setup from the repository root, maintainers need Python 3.12+ and Inno Setup 6+:

```powershell
cd lc0-bot-extension
.\packaging\windows\build-native-host.ps1
iscc "/DMyAppVersion=2026.07.30" packaging\windows\LC0Bot.iss
```

The Windows Setup remains a per-user installer and uses the fixed extension ID in `packaging/windows/LC0Bot.iss`. The GitHub workflow builds that Windows Setup. Ubuntu users run `scripts/install-ubuntu.sh` from the unpacked source repository.

## Folder layout

- `extension/` — unpacked Chrome/Brave extension; its logic is shared by both operating systems.
- `host/` — Native Messaging host source and its focused tests.
- `assets/weights/` — bundled default `evilgyal-6.pb.gz` network.
- `packaging/windows/` — Windows PyInstaller and Inno Setup files.
- `scripts/install-ubuntu.sh` — Ubuntu dependency check, Lc0 source build, and Native Messaging registration.

Build output, source cache, user engine configuration, and installed Ubuntu engine files are not stored in this repository.

## Licensing and responsible use

Ubuntu users build Lc0 from the upstream source on their own computer; this project does not distribute an Ubuntu Lc0 binary. Lc0 is GPLv3-or-later, so users and maintainers should follow its license when using or redistributing source or binaries. The included network is separate from the Lc0 engine license. Users are responsible for following Chess.com rules and the applicable licenses for engine and network files.
