import re
from pathlib import Path
from typing import List, Optional, Tuple

from app.models import Chunk

LINE_RE = re.compile(r"^\[(\d{2}:\d{2}:\d{2})\]\s+([^:]+):\s*(.*)$")


def _norm(s: str) -> str:
    # quote characters are ignored, because models often swap " for '
    for ch in ("\u2019", "\u2018", "\u201c", "\u201d", '"', "'"):
        s = s.replace(ch, "")
    return re.sub(r"\s+", " ", s).strip().lower()


def load_transcript(path: str) -> dict:
    """Returns header dict, and a list of dialogue turns with line numbers (1-based)."""
    lines = Path(path).read_text(encoding="utf-8-sig").splitlines()
    header = {}
    turns = []
    for i, line in enumerate(lines, start=1):
        m = LINE_RE.match(line)
        if m:
            turns.append({"line": i, "timestamp": m.group(1), "speaker": m.group(2).strip(),
                          "text": m.group(3).strip(), "raw": line})
        else:
            if ":" in line and not turns:
                k, v = line.split(":", 1)
                header[k.strip()] = v.strip()
    return {"header": header, "turns": turns, "line_count": len(lines)}


def make_chunks(meeting_id: str, turns: List[dict], size: int = 20, overlap: int = 5) -> List[Chunk]:
    if size <= overlap:
        raise ValueError("size must be larger than overlap")
    chunks = []
    step = size - overlap
    i = 0
    n = 0
    while i < len(turns):
        part = turns[i:i + size]
        n += 1
        chunks.append(Chunk(
            chunk_id=meeting_id + "-C" + str(n).zfill(2),
            meeting_id=meeting_id,
            start_line=part[0]["line"],
            end_line=part[-1]["line"],
            text="\n".join(t["raw"] for t in part),
        ))
        if i + size >= len(turns):
            break
        i += step
    return chunks


def verify_quote(turns: List[dict], timestamp: str, quote: str) -> Tuple[bool, str]:
    """Checks in code: the quote must appear inside the line with this timestamp."""
    q = _norm(quote)
    if len(q) < 8:
        return False, ""
    for t in turns:
        if t["timestamp"] == timestamp:
            if q in _norm(t["text"]):
                return True, t["speaker"]
    return False, ""


def find_quote_anywhere(turns: List[dict], quote: str) -> Optional[dict]:
    """Fallback: if the model gave a wrong timestamp but the quote is real, find its line."""
    q = _norm(quote)
    if len(q) < 8:
        return None
    for t in turns:
        if q in _norm(t["text"]):
            return t
    return None