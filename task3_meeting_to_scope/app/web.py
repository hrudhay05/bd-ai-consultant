import json
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app import store
from app.models import ScopeVersion, Requirement
from app.transcript import load_transcript

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "results"
TRANSCRIPTS = ROOT / "transcripts"
STATIC = ROOT / "static"
PROJECT_ID = "HSD"
FILE_RE = re.compile(r"^extract_[A-Za-z0-9_.\-]+\.json$")

app = FastAPI(title="Task 3 review page")
store.init_db()
if not store.project_exists(PROJECT_ID):
    store.create_project(PROJECT_ID, "Hyderabad Home Services Directory")


class ReviewBody(BaseModel):
    reviewer: str
    decision: str
    note: str = ""


class DraftBody(BaseModel):
    extract: str


def _fail(e: Exception, code: int = 409):
    raise HTTPException(status_code=code, detail=type(e).__name__ + ": " + str(e))


@app.get("/")
def index():
    p = STATIC / "index.html"
    if not p.exists():
        raise HTTPException(status_code=404, detail="static/index.html is missing")
    return FileResponse(str(p))


@app.get("/api/state")
def state():
    transcripts = []
    for p in sorted(TRANSCRIPTS.glob("*.txt")):
        t = load_transcript(str(p))
        first = p.read_text(encoding="utf-8-sig").splitlines()[:1]
        transcripts.append({
            "file": p.name,
            "meeting_id": t["header"].get("Meeting ID", "?"),
            "date": t["header"].get("Date", ""),
            "follow_up_to": t["header"].get("Follow-up to", ""),
            "lines": t["line_count"],
            "turns": len(t["turns"]),
            "role_played": bool(first and "ROLE-PLAYED" in first[0]),
        })
    files = []
    if RESULTS.exists():
        files = sorted(RESULTS.glob("extract_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return {
        "project_id": PROJECT_ID,
        "transcripts": transcripts,
        "extracts": [p.name for p in files],
        "versions": store.list_versions(PROJECT_ID),
        "audit": store.audit_trail(PROJECT_ID)[-30:],
    }


@app.get("/api/extract/{name}")
def get_extract(name: str):
    if not FILE_RE.match(name):
        raise HTTPException(status_code=400, detail="Bad file name")
    p = RESULTS / name
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return json.loads(p.read_text(encoding="utf-8"))


@app.post("/api/draft")
def make_draft(body: DraftBody):
    """SIMULATION helper: makes a draft that holds only extracted requirements."""
    if not FILE_RE.match(body.extract):
        raise HTTPException(status_code=400, detail="Bad file name")
    p = RESULTS / body.extract
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    data = json.loads(p.read_text(encoding="utf-8"))
    try:
        reqs = [Requirement.model_validate(r) for r in data.get("requirements", [])]
    except Exception as e:
        _fail(e, 400)
    sv = ScopeVersion(
        project_id=PROJECT_ID, version=0, requirements=reqs,
        open_questions=[str(o.get("text", "")) for o in data.get("open_questions", [])],
        scope_text="DEMO DRAFT from " + body.extract + ". Requirements only. Scope, estimates and proposal are not built yet.",
    )
    n = store.save_version(sv)
    return {"version": n}


@app.post("/api/version/{v}/submit")
def submit(v: int):
    try:
        store.submit_for_approval(PROJECT_ID, v)
    except (store.InvalidTransition, ValueError) as e:
        _fail(e)
    return {"version": v, "state": "pending_approval"}


@app.post("/api/version/{v}/review")
def do_review(v: int, body: ReviewBody):
    try:
        a = store.review(PROJECT_ID, v, body.reviewer, body.decision, body.note)
    except ValueError as e:
        _fail(e, 400)
    except store.InvalidTransition as e:
        _fail(e)
    return a.model_dump()


@app.post("/api/version/{v}/send")
def do_send(v: int):
    try:
        ts = store.simulate_send(PROJECT_ID, v)
    except (store.SendBlocked, ValueError) as e:
        _fail(e)
    return {"simulated_send": True, "timestamp": ts}