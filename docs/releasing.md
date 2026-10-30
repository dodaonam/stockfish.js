# Build and release policy

## Trigger policy

Only product release workflows are maintained in `.github/workflows/`:

| Workflow | Product | Release tag family |
|---|---|---|
| `release-lc0-unified.yml` | `apps/lc0/unified/` | `lc0-unified-v*` |
| `release-lc0-chesscom.yml` | `apps/lc0/chesscom/` | `lc0bot-v*` |
| `release-stockfish-chesscom-native.yml` | `apps/stockfish/chesscom-native/` | `stfbot-v*` |

Workflows use only the `push` event filtered to `main`, with product-specific path filters. They **do not** run for pull requests or feature-branch pushes. No test-only CI workflow is used. A push to `main` that does not touch a workflow's monitored paths does not trigger that workflow.

Product-specific tags and release artifact names are preserved during the directory migration.

## Windows artifact contract

- Unified LC0: PyInstaller native host + Inno Setup `LC0UnifiedBot-Setup-<version>.exe` + `SHA256SUMS.txt`, unique release tag. The Setup does **not** bundle Lc0 engine, `dnnl.dll`, network weights or the unpacked browser extension.
- Standalone LC0 Chess.com: `LC0Bot-Setup-YYYY.MM.DD.exe` for the separate native host.
- Stockfish Native: `STFBot-Setup-YYYY.MM.DD.exe` for the separate native host.

Follow the corresponding app README for the actual build commands, engine prerequisites, and browser installation. Existing released files and tags are historical artifacts and are not rewritten by the repository move.

## Pre-merge verification

1. Run JavaScript/Python tests and shell syntax checks from [development.md](development.md).
2. Validate native host and packaging references; preserve extension IDs, Native Messaging host names, storage namespaces and engine paths.
3. Verify `on.push.branches` is only `main` and no `pull_request`, `workflow_dispatch` or feature-branch push trigger has been added.
4. Confirm the workflow path filters and working directories match the new source tree.
5. Review extension manifest paths, source links in release notes and expected artifact locations.

Actual Windows installer, engine execution and browser acceptance must be tested on suitable machines; a green Windows release build alone does not prove end-to-end integration.
