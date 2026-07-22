import asyncio
import contextlib
import logging
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import Settings
from .errors import (
    EngineCrashedError,
    EngineNotReadyError,
    EngineTimeoutError,
    SupersededError,
)
from .schemas import VALID_SEARCH_MODES
from .uci_parser import parse_bestmove_line

logger = logging.getLogger(__name__)

HEAD_MODE_ALLOWED_FLAGS = {
    "logfile",
    "weights",
    "backend",
    "backend-opts",
    "nncache",
    "preload",
    "syzygy-paths",
    "chess960",
    "show-wdl",
    "show-movesleft",
    "policy-softmax-temp",
    "history-fill-new",
}


@dataclass
class SearchResult:
    bestmove: Optional[str]
    ponder: Optional[str]
    elapsed_ms: int


@dataclass
class _SearchContext:
    request_id: str
    fen: str
    started_at: float
    future: asyncio.Future


class EngineManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._process: asyncio.subprocess.Process | None = None
        self._stdout_task: asyncio.Task | None = None
        self._mode: str | None = None
        self._started_at = time.monotonic()
        self._last_error: str | None = None

        self._process_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._active_search_lock = asyncio.Lock()

        self._active_search: _SearchContext | None = None
        self._uci_waiter: asyncio.Future | None = None
        self._ready_waiter: asyncio.Future | None = None
        self._stopping = False

    @property
    def ready(self) -> bool:
        return bool(self._process and self._process.returncode is None and self._mode)

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process else None

    @property
    def uptime_sec(self) -> float:
        return max(0.0, time.monotonic() - self._started_at)

    @property
    def active_mode(self) -> str | None:
        return self._mode

    @property
    def last_error(self) -> str | None:
        return self._last_error

    async def startup(self) -> None:
        try:
            await self.ensure_process(self.settings.lc0_default_mode)
        except Exception as exc:
            self._last_error = str(exc)
            logger.warning("Engine startup deferred: %s", exc)

    async def shutdown(self) -> None:
        async with self._process_lock:
            await self._stop_process_locked()

    async def ensure_process(self, mode: str) -> None:
        if mode not in VALID_SEARCH_MODES:
            raise EngineNotReadyError(f"Unsupported search mode: {mode}")

        async with self._process_lock:
            if self._process and self._process.returncode is None and self._mode == mode:
                return
            await self._restart_process_locked(mode)

    async def _restart_process_locked(self, mode: str) -> None:
        await self._stop_process_locked()

        engine_path = self._resolve_engine_path()
        config_path = self._resolve_config_path_for_mode(mode)
        if not os.access(engine_path, os.X_OK):
            raise EngineNotReadyError(f"lc0 binary is not executable: {engine_path}")
        if not config_path.exists():
            raise EngineNotReadyError(f"lc0 config not found at {config_path}")

        cmd = [str(engine_path), mode, f"--config={config_path}"]
        logger.info("Starting lc0: %s", " ".join(cmd))

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        self._mode = mode
        self._stopping = False
        self._stdout_task = asyncio.create_task(self._stdout_reader_loop(), name="lc0-stdout-reader")

        self._uci_waiter = asyncio.get_running_loop().create_future()
        await self._send_command("uci")
        try:
            await asyncio.wait_for(
                self._uci_waiter,
                timeout=self.settings.lc0_ready_timeout_ms / 1000,
            )
        except asyncio.TimeoutError as exc:
            raise EngineNotReadyError("Timed out waiting for uciok from lc0") from exc

        self._ready_waiter = asyncio.get_running_loop().create_future()
        await self._send_command("isready")
        try:
            await asyncio.wait_for(
                self._ready_waiter,
                timeout=self.settings.lc0_ready_timeout_ms / 1000,
            )
        except asyncio.TimeoutError as exc:
            raise EngineNotReadyError("Timed out waiting for readyok from lc0") from exc

        self._last_error = None

    def _resolve_engine_path(self) -> Path:
        raw_path = Path(self.settings.lc0_engine_path)
        if raw_path.exists():
            return raw_path.resolve()

        discovered = shutil.which(self.settings.lc0_engine_path)
        if discovered:
            return Path(discovered).resolve()

        raise EngineNotReadyError(
            "lc0 binary not found. Set LC0_ENGINE_PATH in bridge/.env or add lc0 to PATH."
        )

    def _resolve_config_path_for_mode(self, mode: str) -> Path:
        base_config_path = Path(self.settings.lc0_config_path)
        if not base_config_path.exists():
            raise EngineNotReadyError(f"lc0 config not found at {base_config_path}")

        # classic mode supports the full config surface.
        if mode == "classic":
            return base_config_path

        generated_path = base_config_path.parent / f".lc0.{mode}.generated.config"
        source_lines = base_config_path.read_text(encoding="utf-8").splitlines()

        filtered_lines: list[str] = [
            f"# Auto-generated from {base_config_path.name} for mode '{mode}'.",
            "# Unsupported flags are removed automatically."
        ]
        dropped_flags: set[str] = set()

        for line in source_lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                filtered_lines.append(line)
                continue

            token = stripped
            if token.startswith("--"):
                token = token[2:]
            token = token.split("=", 1)[0].split()[0].strip().lower()
            normalized = token[3:] if token.startswith("no-") else token

            if normalized in HEAD_MODE_ALLOWED_FLAGS:
                filtered_lines.append(line)
            else:
                dropped_flags.add(token)

        generated_path.write_text("\n".join(filtered_lines) + "\n", encoding="utf-8")

        if dropped_flags:
            logger.info(
                "Filtered %d unsupported config flags for mode '%s': %s",
                len(dropped_flags),
                mode,
                ", ".join(sorted(dropped_flags)),
            )

        return generated_path

    async def _stop_process_locked(self) -> None:
        self._stopping = True

        if self._process and self._process.returncode is None:
            with contextlib.suppress(Exception):
                await self._send_command("stop")
            with contextlib.suppress(Exception):
                self._process.terminate()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._process.wait(), timeout=1.0)
            if self._process.returncode is None:
                with contextlib.suppress(Exception):
                    self._process.kill()
                with contextlib.suppress(Exception):
                    await self._process.wait()

        if self._stdout_task:
            self._stdout_task.cancel()
            with contextlib.suppress(Exception):
                await self._stdout_task

        async with self._active_search_lock:
            if self._active_search and not self._active_search.future.done():
                self._active_search.future.set_exception(EngineNotReadyError("Engine is stopping"))
            self._active_search = None

        self._process = None
        self._stdout_task = None
        self._mode = None
        self._uci_waiter = None
        self._ready_waiter = None

    async def _send_command(self, command: str) -> None:
        process = self._process
        if not process or process.returncode is not None or not process.stdin:
            raise EngineNotReadyError("lc0 process is not ready")

        async with self._write_lock:
            process.stdin.write((command + "\n").encode("utf-8"))
            await process.stdin.drain()

    async def _stdout_reader_loop(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return

        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue

                if text == "uciok" and self._uci_waiter and not self._uci_waiter.done():
                    self._uci_waiter.set_result(True)
                    continue

                if text == "readyok" and self._ready_waiter and not self._ready_waiter.done():
                    self._ready_waiter.set_result(True)
                    continue

                if text.startswith("bestmove"):
                    bestmove, ponder = parse_bestmove_line(text)
                    async with self._active_search_lock:
                        if self._active_search and not self._active_search.future.done():
                            elapsed_ms = int((time.perf_counter() - self._active_search.started_at) * 1000)
                            self._active_search.future.set_result(
                                SearchResult(bestmove=bestmove, ponder=ponder, elapsed_ms=elapsed_ms)
                            )
                    continue

            if not self._stopping:
                crash = EngineCrashedError("lc0 process exited unexpectedly")
                self._last_error = crash.message

                if self._uci_waiter and not self._uci_waiter.done():
                    self._uci_waiter.set_exception(crash)
                if self._ready_waiter and not self._ready_waiter.done():
                    self._ready_waiter.set_exception(crash)

                async with self._active_search_lock:
                    if self._active_search and not self._active_search.future.done():
                        self._active_search.future.set_exception(crash)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._last_error = str(exc)
            logger.exception("Error in lc0 stdout reader: %s", exc)

    async def get_bestmove(
        self,
        request_id: str,
        fen: str,
        movetime_s: float,
        search_mode: str,
    ) -> SearchResult:
        await self.ensure_process(search_mode)

        movetime_ms = int(round(movetime_s * 1000))
        loop = asyncio.get_running_loop()
        context = _SearchContext(
            request_id=request_id,
            fen=fen,
            started_at=time.perf_counter(),
            future=loop.create_future(),
        )

        async with self._active_search_lock:
            if self._active_search and not self._active_search.future.done():
                self._active_search.future.set_exception(
                    SupersededError("Search superseded by a newer request")
                )
            self._active_search = context

        try:
            await self._send_command("stop")
            await self._send_command(f"position fen {fen}")
            await self._send_command(f"go movetime {movetime_ms}")

            result = await asyncio.wait_for(
                context.future,
                timeout=self.settings.lc0_search_timeout_ms / 1000,
            )
            return result
        except asyncio.TimeoutError as exc:
            with contextlib.suppress(Exception):
                await self._send_command("stop")
            raise EngineTimeoutError("Timed out waiting for bestmove") from exc
        finally:
            async with self._active_search_lock:
                if self._active_search is context:
                    self._active_search = None
