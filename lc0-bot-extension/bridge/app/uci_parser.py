import re
from typing import Optional, Tuple

BESTMOVE_PATTERN = re.compile(
    r"^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?|\(none\))(?:\s+ponder\s+([a-h][1-8][a-h][1-8][qrbn]?))?$",
    re.IGNORECASE,
)


def parse_bestmove_line(line: str) -> Tuple[Optional[str], Optional[str]]:
    match = BESTMOVE_PATTERN.match((line or "").strip())
    if not match:
        return None, None

    bestmove = match.group(1)
    ponder = match.group(2)

    if bestmove and bestmove.lower() == "(none)":
        bestmove = None

    return (bestmove.lower() if bestmove else None, ponder.lower() if ponder else None)
