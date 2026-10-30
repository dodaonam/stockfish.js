# Local development and verification

Run commands from the **repository root** unless a product README says otherwise. No npm workspace, monorepo orchestrator, or new bundler is required.

## Unpacked extensions

- Unified: `apps/lc0/unified/extension/`
- LC0 Chess.com: `apps/lc0/chesscom/extension/`
- LC0 Lichess: `apps/lc0/lichess/extension/`
- Stockfish Native: `apps/stockfish/chesscom-native/extension/`
- Stockfish Web: `apps/stockfish/chesscom-web/`

Keep each `manifest.json` and its `key` unchanged. Reload the unpacked extension and target tab after editing browser code.

## JavaScript tests

```bash
node --test apps/lc0/unified/tests/*.test.js
node --test apps/lc0/lichess/tests/adapter.test.js
```

## Python native-host tests

```bash
python3 -m unittest discover -s apps/lc0/unified/host/tests -p 'test_*.py' -v
python3 -m unittest discover -s apps/lc0/chesscom/host/tests -p 'test_*.py' -v
python3 -m unittest discover -s apps/lc0/lichess/host/tests -p 'test_*.py' -v
```

## Static and packaging checks

```bash
bash -n apps/lc0/unified/scripts/install-ubuntu.sh
bash -n apps/lc0/chesscom/scripts/install-ubuntu.sh
bash -n apps/lc0/lichess/scripts/install-ubuntu.sh
python3 apps/lc0/unified/packaging/windows/validate-release.py
```

The Stockfish Native `validate-release.py` script requires a previously built `dist/stf-native-host.exe`; run it on Windows **after** the native host build, not as a source-only check.

On Windows, follow the relevant product README to build the PyInstaller native host and Inno Setup executable. Packaging checks are not substitutes for actual Windows 11/Chrome/Brave clean-install and browser tests.

## Engine smoke test

After installing the unified Lc0 engine and host on supported Ubuntu, run:

```bash
python3 apps/lc0/unified/scripts/smoke-engine.py
```

This performs an actual UCI calculation; unit tests only verify source/protocol behavior.

## CI policy

There are **no test-only GitHub Actions**. Tests run locally. The only workflows on GitHub build and publish Windows Setup artifacts after relevant pushes/merges to `main`. No workflows run on feature branch pushes or pull requests.
