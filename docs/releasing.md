# Build and release policy

## Trigger policy

Only the following **product build-and-release** workflows are maintained in `.github/workflows/`:

| Workflow | Product | Release tag format |
|---|---|---|
| `release-lc0-unified.yml` | `apps/lc0/unified/` | `lc0-unified-vYYYY.MM.DD.RUN_NUMBER-rRUN_ATTEMPT` |
| `release-lc0-chesscom.yml` | `apps/lc0/chesscom/` | `lc0bot-vYYYY.MM.DD.RUN_NUMBER-rRUN_ATTEMPT` |
| `release-stockfish-chesscom-native.yml` | `apps/stockfish/chesscom-native/` | `stfbot-vYYYY.MM.DD.RUN_NUMBER-rRUN_ATTEMPT` |

All workflows trigger **only on `push` to `main`** with product-specific path filters. They do **not** run on pull requests, feature-branch pushes, manual dispatch or schedules. There is no test-only GitHub Actions workflow. A push to `main` outside the monitored paths triggers no release for that product.

The standalone Lc0 Lichess application currently has a Windows installer source but **no automated release workflow**. Its Windows Setup is built manually; do not conflate this with the Unified release.

## Release identity and provenance

- Each successful workflow run creates a **new, commit-bound Git tag** and GitHub Release. The UTC date, `GITHUB_RUN_NUMBER` and `GITHUB_RUN_ATTEMPT` prevent same-day pushes and reruns from reusing an existing tag.
- The release points at the exact `GITHUB_SHA` used to build its installer. Release notes link to the matching extension source at that commit.
- Published release assets are **never updated with `--clobber`**. Each automated release includes its Setup executable and `SHA256SUMS.txt` (SHA-256 checksum).
- These versioning rules apply to **new releases only**. Historical releases, filenames and tags—including older date-only releases—are retained unchanged; no retroactive retagging or asset modification is performed.

## Windows artifact contract

- Unified Lc0: PyInstaller native host + Inno Setup `LC0UnifiedBot-Setup-<version>.exe` + `SHA256SUMS.txt`.
- Standalone Lc0 Chess.com: `LC0Bot-Setup-<version>.exe` + `SHA256SUMS.txt`.
- Stockfish Native: `STFBot-Setup-<version>.exe` + `SHA256SUMS.txt`.

The Windows installers install **only the Native Messaging host**. They do not bundle the respective native chess engine, network weights or unpacked browser extensions. Obtain and configure the required engine separately as described in each product's README.

## Local testing and pre-merge verification

1. Run JavaScript/Python tests and shell syntax checks from [development.md](development.md).
2. Validate native host and packaging references; preserve extension IDs, Native Messaging host names, storage namespaces and engine paths.
3. Check `on.push.branches` is only `main`; there must be no `pull_request`, `workflow_dispatch` or feature-branch trigger.
4. Check workflow path filters, working directories, output paths, source URLs and checksum filenames.
5. Check new releases use a unique tag and `--target GITHUB_SHA`, with no release asset overwrite.

Actual Windows installer, engine execution, installation, uninstallation and browser acceptance must be tested on suitable machines. A successful CI build is **not** proof of Windows end-to-end integration. The operator owns that real-platform verification.

## Legacy archive policy

Both former root-level Tampermonkey userscripts now reside solely in `legacy/userscripts/`. Their old GitHub Raw URLs are intentionally broken by this migration; **no compatibility files** are kept at the root. Archived userscripts are unsupported and excluded from active maintenance and testing.
