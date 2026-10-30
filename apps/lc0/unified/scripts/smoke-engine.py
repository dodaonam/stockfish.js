#!/usr/bin/env python3
"""Read-only end-to-end smoke test for the installed unified Lc0 engine."""
from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "host"))

from native_host import HostError, UciEngine

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def main() -> int:
    data_home = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share")))
    app_home = Path(os.environ.get("LC0UNIFIEDBOT_HOME", str(data_home / "lc0unifiedbot")))

    engine = UciEngine()
    engine.root = app_home.expanduser().resolve()
    try:
        bestmove, _, elapsed_ms = engine.bestmove(START_FEN, "movetime", movetime_ms=100)
        if bestmove is None:
            print("Unified Lc0 engine did not return a move", file=sys.stderr)
            return 1
        print(f"Unified Lc0 engine OK: {bestmove} in {elapsed_ms} ms")
        return 0
    except (HostError, OSError) as error:
        print(f"Unified Lc0 engine FAILED: {error}", file=sys.stderr)
        return 1
    finally:
        engine.stop()


if __name__ == "__main__":
    raise SystemExit(main())
