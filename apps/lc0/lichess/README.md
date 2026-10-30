# LC0 Bot for Lichess (Chrome/Brave, Windows/Ubuntu)

This is the Lichess port of [LC0 Bot](../chesscom). The scheduler,
native LC0 engine, settings, popup, Stockfish depth-11 evaluation, highlights and
shortcuts are copied from that extension. Only the platform integration and
Native Messaging registration differ.

Lichess round WebSocket → Lichess page adapter → shared LC0 scheduler → native host → LC0 CPU.

## Install

- Windows: obtain the official LC0 CPU/oneDNN package with lc0.exe, dnnl.dll,
  and one .pb.gz network. Build the host with
  packaging/windows/build-native-host.ps1, then build the Windows Setup using
  packaging/windows/LC0Bot.iss, and install it.
- Ubuntu 22.04+ x86_64: from repository root run
  bash apps/lc0/lichess/scripts/install-ubuntu.sh.
  This installs a separately named native host and a local CPU/OpenBLAS LC0 build.
- In Chrome or Brave open chrome://extensions, enable Developer Mode,
  and Load unpacked from apps/lc0/lichess/extension/.
- Open a Lichess standard-chess round page and reload it if already open.
  The toolbar popup reports native-host readiness.

The Lichess extension has its own fixed extension ID and host registration.
Installing it does not overwrite the Chess.com extension's native host.

## Equivalent controls

- Popup: Enable Extension and LC0 host readiness, same as the Chess.com LC0 standalone package.
- In-page green LC0 button and LC0 Settings panel: Auto Run, Auto Move,
  Show Evaluation Bar, Move Time / Nodes (1–10000), search time (0.001–10 s),
  random delay range (0–30 s).
- Shortcuts: h = hide/restore button and panel, z = toggle panel,
  s = toggle Auto Run, b = toggle evaluation bar.
- Stockfish depth-11 eval bar runs independently of LC0, including when it
  is not the player's turn. It downloads the same engine resources as the original.
- The chosen UCI move is highlighted when Auto Move is off. The page adapter
  uses Lichess' round socket format for submitting a move when Auto Move is on.

This adapter accepts only active standard games where the round data identifies
the user as a player. Spectator mode, Chess960, other variants, analyses,
and puzzles are not handled as playable round sessions. Lichess sends board
placement only in round steps; the adapter reconstructs a full UCI FEN from
the server's move history. It requires page reload to intercept the round socket.

## Fair play warning

Lichess prohibits programmatic moves through the website GUI **even against
Lichess AI**. It also prohibits engine assistance in human games. The website
allows engines while playing against its own AI, but still forbids automatic
moves through the GUI. Use the extension only in ways permitted by the platform.
For sanctioned automated engine games use a dedicated Lichess BOT account and
its official Bot API instead of browser automation:
https://lichess.org/page/fair-play

## Source layout and engineering

- extension/ — Manifest V3 Chrome/Brave extension. Shared logic is kept aligned
  with apps/lc0/chesscom/extension/; adapters/lichess-dom.js is Lichess-specific.
- host/ — independent local LC0 Native Messaging host and tests.
- assets/weights/ — packaged default LC0 network.
- scripts/install-ubuntu.sh — Ubuntu installer.
- packaging/windows/ — Windows PyInstaller / Inno Setup build inputs.

The native host uses com.lc0bot.lichessnativehost, stores Ubuntu files in
~/.local/share/lc0lichessbot, and accepts only the pinned Lichess extension ID.
The Windows setup uses a separate application ID and directory. Changes to
the LC0 engine or network can be applied by reloading the extension and tab.

The Lc0 engine is GPLv3-or-later. Users are responsible for licenses,
the platform's fair-play requirements, and local installation.

Static adapter regression tests: `node --test apps/lc0/lichess/tests/adapter.test.js`.
