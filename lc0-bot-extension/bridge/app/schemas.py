import re

from pydantic import BaseModel, Field, field_validator
from typing import Literal

VALID_SEARCH_MODES = ("classic", "policyhead", "valuehead")

PIECES_ONLY = re.compile(r"^[prnbqkPRNBQK1-8/]+$")
EN_PASSANT = re.compile(r"^(-|[a-h][36])$")


class BestMoveRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    fen: str = Field(min_length=7, max_length=128)
    movetime_s: float = Field(ge=0.01, le=10)
    search_mode: Literal["classic", "policyhead", "valuehead"] = "classic"

    @field_validator("fen")
    @classmethod
    def validate_fen(cls, value: str) -> str:
        fen = (value or "").strip()
        parts = fen.split()
        if len(parts) < 4:
            raise ValueError("FEN must contain at least 4 fields.")

        placement, side, castling, en_passant = parts[:4]
        ranks = placement.split("/")
        if len(ranks) != 8:
            raise ValueError("FEN board placement must contain 8 ranks.")

        for rank in ranks:
            if not PIECES_ONLY.match(rank):
                raise ValueError("FEN board placement contains invalid piece tokens.")
            square_count = 0
            for char in rank:
                square_count += int(char) if char.isdigit() else 1
            if square_count != 8:
                raise ValueError("Each FEN rank must represent exactly 8 squares.")

        if side not in ("w", "b"):
            raise ValueError("FEN side-to-move must be 'w' or 'b'.")

        if castling != "-" and not re.match(r"^[KQkq]+$", castling):
            raise ValueError("FEN castling field is invalid.")

        if not EN_PASSANT.match(en_passant):
            raise ValueError("FEN en-passant field is invalid.")

        return fen


class BestMoveSuccess(BaseModel):
    ok: bool = True
    request_id: str
    bestmove: str | None
    ponder: str | None = None
    fen_echo: str
    elapsed_ms: int
    search_mode: Literal["classic", "policyhead", "valuehead"]


class BestMoveError(BaseModel):
    ok: bool = False
    request_id: str
    code: str
    message: str


class HealthResponse(BaseModel):
    ok: bool = True
    engine: str = "lc0"
    ready: bool
    pid: int | None
    uptime_sec: float
    active_mode: str | None = None
    last_error: str | None = None
