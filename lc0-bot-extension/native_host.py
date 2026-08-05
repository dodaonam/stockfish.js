#!/usr/bin/env python3
"""Chrome Native Messaging host for a user-supplied Windows CPU build of Lc0.

This program deliberately writes protocol frames only to stdout. Diagnostics go
to stderr so they cannot corrupt Chrome's Native Messaging stream.
"""

from __future__ import annotations

import json
import os
import queue
import re
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any


MAX_MESSAGE_BYTES = 1_000_000
CONFIG_FILE_NAME = "engine-config.json"
STARTUP_TIMEOUT_SEC = 15.0
SEARCH_GRACE_SEC = 5.0
NODES_MIN = 1
NODES_MAX = 10_000
UCI_MOVE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$", re.IGNORECASE)
PIECES = re.compile(r"^[prnbqkPRNBQK1-8]+$")
EN_PASSANT = re.compile(r"^(-|[a-h][36])$")


class HostError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[LC0 Native Host] {message}", file=sys.stderr, flush=True)


def application_dir() -> Path:
    override = os.environ.get("LC0BOT_HOME")
    if override:
        return Path(override).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def load_engine_dir(root: Path) -> Path:
    config_path = root / CONFIG_FILE_NAME
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HostError("CONFIG_NOT_FOUND", "LC0 Bot is not configured. Run LC0Bot Setup again.") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise HostError("CONFIG_INVALID", "LC0 Bot engine configuration is invalid. Run Setup again.") from exc
    raw_dir = config.get("engineDir") if isinstance(config, dict) else None
    if not isinstance(raw_dir, str) or not raw_dir.strip():
        raise HostError("CONFIG_INVALID", "LC0 Bot engine directory is missing. Run Setup again.")
    engine_dir = Path(raw_dir).expanduser()
    if not engine_dir.is_dir():
        raise HostError("ENGINE_DIRECTORY_NOT_FOUND", f"Configured LC0 folder no longer exists: {engine_dir}")
    return engine_dir.resolve()


def find_weights(engine_dir: Path) -> Path:
    candidates: list[Path] = []
    for directory in (engine_dir, engine_dir / "weights"):
        if directory.is_dir():
            candidates.extend(path.resolve() for path in directory.glob("*.pb.gz") if path.is_file())
    candidates = sorted(set(candidates), key=lambda path: path.name.casefold())
    if not candidates:
        raise HostError("WEIGHTS_NOT_FOUND", "No .pb.gz weight was found in the LC0 folder or its weights folder.")
    if len(candidates) > 1:
        names = ", ".join(path.name for path in candidates)
        raise HostError("MULTIPLE_WEIGHTS", f"Found multiple .pb.gz weights ({names}). Keep exactly one weight file.")
    return candidates[0]


def read_exact(stream: Any, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            raise EOFError
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_message() -> dict[str, Any] | None:
    try:
        raw_length = read_exact(sys.stdin.buffer, 4)
    except EOFError:
        return None

    (length,) = struct.unpack("=I", raw_length)
    if length > MAX_MESSAGE_BYTES:
        raise HostError("MESSAGE_TOO_LARGE", "Native message exceeds the 1 MB limit")

    try:
        payload = read_exact(sys.stdin.buffer, length)
        message = json.loads(payload.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HostError("INVALID_JSON", "Native message must be UTF-8 JSON") from exc
    except json.JSONDecodeError as exc:
        raise HostError("INVALID_JSON", "Native message is not valid JSON") from exc

    if not isinstance(message, dict):
        raise HostError("INVALID_REQUEST", "Native message must be a JSON object")
    return message


def write_message(message: dict[str, Any]) -> None:
    payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_MESSAGE_BYTES:
        raise HostError("MESSAGE_TOO_LARGE", "Native response exceeds the 1 MB limit")
    sys.stdout.buffer.write(struct.pack("=I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def validate_fen(value: Any) -> str:
    if not isinstance(value, str):
        raise HostError("INVALID_FEN", "FEN must be a string")

    fen = value.strip()
    if "\n" in fen or "\r" in fen:
        raise HostError("INVALID_FEN", "FEN must not contain line breaks")

    fields = fen.split()
    if len(fields) not in (4, 6):
        raise HostError("INVALID_FEN", "FEN must contain 4 or 6 fields")

    placement, side, castling, en_passant = fields[:4]
    ranks = placement.split("/")
    if len(ranks) != 8:
        raise HostError("INVALID_FEN", "FEN board placement must contain 8 ranks")
    for rank in ranks:
        if not PIECES.fullmatch(rank):
            raise HostError("INVALID_FEN", "FEN board placement contains invalid pieces")
        squares = sum(int(char) if char.isdigit() else 1 for char in rank)
        if squares != 8:
            raise HostError("INVALID_FEN", "Each FEN rank must contain exactly 8 squares")

    if side not in ("w", "b"):
        raise HostError("INVALID_FEN", "FEN side to move must be w or b")
    if castling != "-" and not re.fullmatch(r"[KQkq]+", castling):
        raise HostError("INVALID_FEN", "FEN castling field is invalid")
    if not EN_PASSANT.fullmatch(en_passant):
        raise HostError("INVALID_FEN", "FEN en-passant field is invalid")
    if len(fields) == 6 and (not fields[4].isdigit() or not fields[5].isdigit()):
        raise HostError("INVALID_FEN", "FEN move counters must be integers")

    return fen


class UciEngine:
    def __init__(self) -> None:
        self.root = application_dir()
        self.process: subprocess.Popen[str] | None = None
        self.lines: queue.Queue[str] = queue.Queue()
        self.reader: threading.Thread | None = None
        self.stderr_reader: threading.Thread | None = None

    def _engine_path(self) -> Path:
        engine_dir = load_engine_dir(self.root)
        path = engine_dir / "lc0.exe"
        if not path.is_file():
            raise HostError("ENGINE_NOT_FOUND", f"lc0.exe was not found at {path}")
        dnnl_path = engine_dir / "dnnl.dll"
        if not dnnl_path.is_file():
            raise HostError("DNNL_NOT_FOUND", f"dnnl.dll was not found at {dnnl_path}")
        return path.resolve()

    def _weights_path(self) -> Path:
        return find_weights(load_engine_dir(self.root))

    def _read_stdout(self) -> None:
        assert self.process and self.process.stdout
        for line in self.process.stdout:
            self.lines.put(line.strip())

    def _read_stderr(self) -> None:
        assert self.process and self.process.stderr
        for line in self.process.stderr:
            text = line.strip()
            if text:
                log(f"lc0: {text}")

    def _send(self, command: str) -> None:
        process = self.process
        if not process or process.poll() is not None or not process.stdin:
            raise HostError("ENGINE_CRASHED", "lc0 process is not running")
        process.stdin.write(command + "\n")
        process.stdin.flush()

    def _wait_for(self, predicate: Any, timeout_sec: float, error_message: str) -> str:
        deadline = time.monotonic() + timeout_sec
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise HostError("ENGINE_TIMEOUT", error_message)
            try:
                line = self.lines.get(timeout=remaining)
            except queue.Empty as exc:
                raise HostError("ENGINE_TIMEOUT", error_message) from exc
            if predicate(line):
                return line

    def start(self) -> None:
        if self.process and self.process.poll() is None:
            return

        self.stop()
        engine_path = self._engine_path()
        weights_path = self._weights_path()
        raw_threads = os.environ.get("LC0_THREADS", "0")
        try:
            threads = min(max(int(raw_threads), 0), 128)
        except ValueError:
            threads = 0

        command = [
            str(engine_path),
            "classic",
            "--backend=blas",
            f"--weights={weights_path}",
            "--preload",
            f"--threads={threads}",
            "--max-concurrent-searchers=1",
            "--multipv=1",
            "--nncache=400000",
            "--move-overhead=0",
        ]
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        log(f"Starting lc0 CPU engine from {engine_path}")
        self.process = subprocess.Popen(
            command,
            cwd=str(engine_path.parent),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creation_flags,
        )
        self.lines = queue.Queue()
        self.reader = threading.Thread(target=self._read_stdout, name="lc0-stdout", daemon=True)
        self.stderr_reader = threading.Thread(target=self._read_stderr, name="lc0-stderr", daemon=True)
        self.reader.start()
        self.stderr_reader.start()

        try:
            self._send("uci")
            self._wait_for(lambda line: line == "uciok", STARTUP_TIMEOUT_SEC, "Timed out waiting for lc0 uciok")
            self._send("isready")
            self._wait_for(lambda line: line == "readyok", STARTUP_TIMEOUT_SEC, "Timed out waiting for lc0 readyok")
        except HostError:
            self.stop()
            raise

    def bestmove(
        self,
        fen: str,
        search_mode: str,
        movetime_ms: int | None = None,
        nodes: int | None = None,
    ) -> tuple[str | None, str | None, int]:
        self.start()
        started_at = time.perf_counter()
        self._send("position fen " + fen)

        if search_mode == "nodes":
            if nodes is None or not NODES_MIN <= nodes <= NODES_MAX:
                raise HostError("INVALID_REQUEST", f"nodes must be an integer from {NODES_MIN} to {NODES_MAX}")
            go_command = f"go nodes {nodes}"
            timeout_sec = 60.0
        elif search_mode == "movetime":
            if movetime_ms is None or movetime_ms < 1:
                raise HostError("INVALID_REQUEST", "movetimeMs must be positive")
            go_command = f"go movetime {movetime_ms}"
            timeout_sec = movetime_ms / 1000 + SEARCH_GRACE_SEC
        else:
            raise HostError("INVALID_REQUEST", "searchMode must be movetime or nodes")

        self._send(go_command)

        line = self._wait_for(
            lambda candidate: candidate.lower().startswith("bestmove "),
            timeout_sec,
            "Timed out waiting for lc0 bestmove",
        )
        tokens = line.split()
        bestmove = tokens[1].lower() if len(tokens) > 1 else None
        ponder = tokens[3].lower() if len(tokens) > 3 and tokens[2].lower() == "ponder" else None
        if bestmove == "(none)":
            bestmove = None
        elif not bestmove or not UCI_MOVE.fullmatch(bestmove):
            raise HostError("INVALID_ENGINE_RESPONSE", f"lc0 returned an invalid bestmove: {line}")
        if ponder and not UCI_MOVE.fullmatch(ponder):
            ponder = None
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        return bestmove, ponder, elapsed_ms

    def stop(self) -> None:
        process = self.process
        self.process = None
        if not process:
            return
        try:
            if process.poll() is None and process.stdin:
                process.stdin.write("quit\n")
                process.stdin.flush()
                process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()


def request_id_from(message: dict[str, Any]) -> str:
    request_id = message.get("requestId")
    return request_id if isinstance(request_id, str) and len(request_id) <= 128 else ""


def error_payload(request_id: str, error: HostError) -> dict[str, Any]:
    return {
        "ok": False,
        "requestId": request_id,
        "code": error.code,
        "message": error.message,
    }


def handle_message(engine: UciEngine, message: dict[str, Any]) -> dict[str, Any]:
    request_id = request_id_from(message)
    message_type = message.get("type")

    if message_type == "PING":
        engine_dir = load_engine_dir(engine.root)
        engine_path = engine._engine_path()
        weights = find_weights(engine_dir)
        return {"ok": True, "requestId": request_id, "engine": "lc0", "mode": "classic", "enginePath": str(engine_path), "weights": weights.name}
    if message_type != "BESTMOVE" or not request_id:
        raise HostError("INVALID_REQUEST", "BESTMOVE requests require a requestId")

    fen = validate_fen(message.get("fen"))
    search_mode = message.get("searchMode", "movetime")

    if search_mode == "nodes":
        raw_nodes = message.get("nodes")
        if (
            not isinstance(raw_nodes, int)
            or isinstance(raw_nodes, bool)
            or not NODES_MIN <= raw_nodes <= NODES_MAX
        ):
            raise HostError("INVALID_REQUEST", f"nodes must be an integer from {NODES_MIN} to {NODES_MAX}")
        nodes = raw_nodes
        movetime_ms = None
    elif search_mode == "movetime":
        raw_movetime = message.get("movetimeMs")
        if not isinstance(raw_movetime, (int, float)) or isinstance(raw_movetime, bool):
            raise HostError("INVALID_REQUEST", "movetimeMs must be a number")
        movetime_ms = min(max(int(round(raw_movetime)), 1), 10_000)
        nodes = None
    else:
        raise HostError("INVALID_REQUEST", "searchMode must be movetime or nodes")

    bestmove, ponder, elapsed_ms = engine.bestmove(
        fen,
        search_mode,
        movetime_ms=movetime_ms,
        nodes=nodes,
    )
    return {
        "ok": True,
        "requestId": request_id,
        "bestmove": bestmove,
        "ponder": ponder,
        "elapsedMs": elapsed_ms,
        "fenEcho": fen,
        "searchMode": search_mode,
        "movetimeMs": movetime_ms,
        "nodes": nodes,
    }


def main() -> int:
    engine = UciEngine()
    try:
        while True:
            try:
                message = read_message()
            except HostError as error:
                log(error.message)
                write_message(error_payload("", error))
                continue

            if message is None:
                return 0

            request_id = request_id_from(message)
            try:
                write_message(handle_message(engine, message))
            except HostError as error:
                if error.code in {"ENGINE_CRASHED", "ENGINE_TIMEOUT", "INVALID_ENGINE_RESPONSE"}:
                    engine.stop()
                write_message(error_payload(request_id, error))
            except Exception as error:  # pragma: no cover - last-resort host safety
                log(f"Unexpected host error: {error}")
                engine.stop()
                write_message({
                    "ok": False,
                    "requestId": request_id,
                    "code": "INTERNAL",
                    "message": "Unexpected LC0 Native Host error",
                })
    finally:
        engine.stop()


if __name__ == "__main__":
    raise SystemExit(main())
