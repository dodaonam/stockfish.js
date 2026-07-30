# LC0 Bot for Windows

LC0 Bot is an unpacked Chrome extension for Chess.com. It talks to a local
Windows CPU/oneDNN build of [Lc0](https://lczero.org/play/download/) through
Chrome Native Messaging—there is no FastAPI server, localhost port, Python
runtime, or manual Extension ID step for end users.

It supports 64-bit Windows systems that can run x64 applications.

```text
Chess.com page → extension → Native Messaging host → user-supplied lc0.exe
```

The host uses Lc0 `classic` search with the CPU package's `blas` backend.
The engine process remains local to the current Windows user.

## Use the extension

1. Clone this repository.
2. Download and extract the official **Windows CPU/oneDNN** Lc0 package. It
   must contain `lc0.exe`, `dnnl.dll`, and exactly one `*.pb.gz` network,
   either in that folder or its `weights` subfolder.
3. From this repository's GitHub Release, download and double-click the only
   asset: `LC0Bot-Setup-YYYY.MM.DD.exe`. Select the extracted Lc0 folder when
   asked. Setup installs only the Native Messaging host under
   `%LOCALAPPDATA%\LC0Bot` and registers it for the current user; it does not
   copy, download, bundle, or modify Lc0 or its weights.
4. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select this repository's `lc0-bot-extension/extension`
   folder.
5. Open a supported Chess.com play, game, or puzzle page. The extension popup
   reports whether the local host is ready; the green **LC0** button opens its
   settings.

## Change weights without Setup

Replace the old `*.pb.gz` file with the new weight in the configured Lc0
folder (or its `weights` subfolder), leaving **exactly one** `*.pb.gz` file in
those two locations. The filename may be anything. Reload the extension from
`chrome://extensions`; the next native-host connection scans the folder again
and uses the new file.

Run Setup again only if the Lc0 folder itself moves. If there are zero or more
than one weight files, the popup exposes the clear host error instead of
guessing which network to use.

## Development and release

End users use the Release installer and do not build locally. Maintainers can
build the host and setup manually on Windows:

```powershell
cd lc0-bot-extension
.\build-native-host.ps1
iscc "/DMyAppVersion=2026.07.30" LC0Bot.iss
```

`LC0Bot.iss` creates a per-user installer. Its fixed public extension key
keeps the unpacked extension ID stable, so the installer can safely restrict
the Native Messaging host to this extension without asking users to copy an
ID. The corresponding private key is intentionally not stored in this
repository.

GitHub Actions runs only after a push to `main` that changes
`lc0-bot-extension/**` or its workflow. It builds the host, creates the setup
executable, then creates or replaces the single release asset for the UTC date
tag `lc0bot-vYYYY.MM.DD`. No checksum file or other release asset is produced.

## Project layout

- `extension/` — unpacked Manifest V3 extension.
- `native_host.py` — length-prefixed JSON Native Messaging host and UCI client.
- `build-native-host.ps1` / `requirements-build.txt` — reproducible PyInstaller host build.
- `LC0Bot.iss` — Inno Setup installer and native-host Registry registration.
- `.github/workflows/release-lc0-bot.yml` — CI build and daily Release upload.

Build directories such as `build/`, `dist/`, Python cache, and PyInstaller
specification files are local artifacts and are ignored by Git.

## License and fair use

This project does not provide, download, redistribute, or modify Lc0 binaries,
DLLs, or neural-network weights. Users obtain them directly from the official
Lc0 distribution and are responsible for applicable licenses and terms. Use
the extension only in ways permitted by Chess.com and the games involved.
