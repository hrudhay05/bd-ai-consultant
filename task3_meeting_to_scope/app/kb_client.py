from dataclasses import dataclass, field
import httpx
from app import config

# outcome values:
# answered | insufficient_evidence | kb_error | unreachable | auth_failed | bad_request | timeout


@dataclass
class KBResult:
    outcome: str
    answer: str = ""
    sources: list = field(default_factory=list)
    needs_human: bool = False
    reason: str = ""
    latency_ms: int = 0
    dropped_changelog: int = 0
    detail: str = ""


def _is_changelog(src: dict) -> bool:
    text = (str(src.get("title", "")) + " " + str(src.get("url", ""))).lower()
    return "changelog" in text


def query_kb(question: str, timeout: float = 60.0) -> KBResult:
    url = config.KB_URL.rstrip("/") + "/query"
    headers = {"X-API-Key": config.KB_API_KEY}
    try:
        r = httpx.post(url, json={"question": question}, headers=headers, timeout=timeout)
    except httpx.ConnectError:
        return KBResult(outcome="unreachable", detail="Task 1 is not reachable (connection refused)")
    except httpx.TimeoutException:
        return KBResult(outcome="timeout", detail="Task 1 did not answer in time")
    except httpx.HTTPError as e:
        return KBResult(outcome="unreachable", detail="HTTP error: " + type(e).__name__)

    if r.status_code in (401, 403):
        return KBResult(outcome="auth_failed", detail="HTTP " + str(r.status_code))
    if r.status_code == 422:
        return KBResult(outcome="bad_request", detail="HTTP 422 (question rejected, maybe too short)")
    if r.status_code != 200:
        return KBResult(outcome="kb_error", detail="HTTP " + str(r.status_code))

    try:
        data = r.json()
    except ValueError:
        return KBResult(outcome="kb_error", detail="Response was not JSON")

    status = data.get("status")
    if status not in ("answered", "insufficient_evidence"):
        return KBResult(outcome="kb_error", detail="status=" + str(status), reason=str(data.get("reason") or ""))

    all_sources = data.get("sources") or []
    kept = [s for s in all_sources if not _is_changelog(s)]
    dropped = len(all_sources) - len(kept)

    outcome = status
    if status == "answered" and not kept:
        # only changelog evidence: treat as not enough evidence, never as proof
        outcome = "insufficient_evidence"

    return KBResult(
        outcome=outcome,
        answer=str(data.get("answer") or ""),
        sources=kept,
        needs_human=bool(data.get("needs_human")),
        reason=str(data.get("reason") or ""),
        latency_ms=int(data.get("latency_ms") or 0),
        dropped_changelog=dropped,
    )
