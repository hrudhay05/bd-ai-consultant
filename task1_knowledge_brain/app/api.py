from fastapi.responses import FileResponse
import os, json, sqlite3, subprocess, sys, time, uuid
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Depends, Header, BackgroundTasks
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from app import rag
from retrieval import search as searchmod

load_dotenv()
API_KEY = os.getenv("KB_API_KEY")
DB = "data/kb.db"
MANIFEST = "data/manifest.json"

app = FastAPI(title="Knowledge Brain API", version="0.1")

@app.get("/", include_in_schema=False)
def home():
    return FileResponse("frontend/index.html")
# ---------- auth ----------
def require_key(x_api_key: Optional[str] = Header(default=None)):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


# ---------- database ----------
def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS escalations (
            id TEXT PRIMARY KEY, question TEXT, reason TEXT, evidence TEXT,
            status TEXT, created_at TEXT, answer TEXT, reviewer TEXT,
            answered_at TEXT, version INTEGER DEFAULT 0, approved INTEGER DEFAULT 0)""")

init_db()

def now():
    return datetime.now(timezone.utc).isoformat()


# ---------- schemas ----------
class QueryRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    create_escalation: bool = True

class Source(BaseModel):
    title: str
    url: str
    relevance: float
    images: List[str] = []

class QueryResponse(BaseModel):
    status: str                      # answered | insufficient_evidence | error
    answer: Optional[str]
    sources: List[Source]
    needs_human: bool
    reason: Optional[str]
    escalation_id: Optional[str] = None
    latency_ms: int

class EscalationCreate(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    reason: str = "manual"

class ResolveRequest(BaseModel):
    expert_answer: str = Field(min_length=3)
    reviewer: str = "expert"
    approved_for_retrieval: bool = False   # only True after a human reviews it


# ---------- helpers ----------
def create_escalation(question, reason, evidence):
    eid = uuid.uuid4().hex[:12]
    with db() as c:
        c.execute("INSERT INTO escalations (id, question, reason, evidence, status, created_at) "
                  "VALUES (?,?,?,?,?,?)",
                  (eid, question, reason, json.dumps(evidence), "open", now()))
    return eid


# ---------- endpoints ----------
@app.get("/health")
def health():
    return {"status": "ok", "chunks_indexed": searchmod.col.count(),
            "llm_provider": os.getenv("LLM_PROVIDER", "groq"),
            "llm_model": os.getenv("LLM_MODEL")}

@app.post("/query", response_model=QueryResponse, dependencies=[Depends(require_key)])
def query(req: QueryRequest):
    t0 = time.time()
    result = rag.ask(req.question.strip())
    eid = None
    if result["needs_human"] and req.create_escalation:
        evidence = [{"title": h["title"], "url": h["url"], "score": h["score"]}
                    for h in searchmod.search(req.question, k=3)]
        eid = create_escalation(req.question, result["reason"], evidence)
    return {**result, "escalation_id": eid, "latency_ms": int((time.time() - t0) * 1000)}

@app.post("/escalations", dependencies=[Depends(require_key)])
def new_escalation(req: EscalationCreate):
    return {"escalation_id": create_escalation(req.question, req.reason, []), "status": "open"}

@app.get("/escalations", dependencies=[Depends(require_key)])
def list_escalations(status: Optional[str] = None):
    with db() as c:
        rows = c.execute("SELECT * FROM escalations" + (" WHERE status=?" if status else "")
                         + " ORDER BY created_at DESC", (status,) if status else ()).fetchall()
    return [dict(r) for r in rows]

@app.post("/escalations/{eid}/resolve", dependencies=[Depends(require_key)])
def resolve(eid: str, req: ResolveRequest):
    with db() as c:
        row = c.execute("SELECT * FROM escalations WHERE id=?", (eid,)).fetchone()
        if not row:
            raise HTTPException(404, "Escalation not found")
        version = (row["version"] or 0) + 1
        c.execute("UPDATE escalations SET status='resolved', answer=?, reviewer=?, "
                  "answered_at=?, version=?, approved=? WHERE id=?",
                  (req.expert_answer, req.reviewer, now(), version,
                   int(req.approved_for_retrieval), eid))

    # make it retrievable only if a reviewer approved it
    if req.approved_for_retrieval:
        old = f"expert-{eid}-v{version - 1}"
        if version > 1:
            searchmod.col.delete(ids=[old])
        doc = f"Expert answer: {row['question']}\n{req.expert_answer}"
        emb = searchmod.model.encode([doc], normalize_embeddings=True).tolist()
        searchmod.col.add(
            ids=[f"expert-{eid}-v{version}"], documents=[doc], embeddings=emb,
            metadatas=[{"url": f"expert://escalations/{eid}",
                        "title": "Expert answer: " + row["question"][:80],
                        "section": "Expert answer", "images": "[]", "content_hash": ""}])

    # add the original question to the evaluation set
    with open("data/eval_additions.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"question": row["question"], "expected": req.expert_answer,
                            "escalation_id": eid}, ensure_ascii=False) + "\n")
    return {"escalation_id": eid, "status": "resolved", "version": version,
            "indexed": req.approved_for_retrieval}


# ---------- ingestion ----------
JOB = {"state": "idle", "started_at": None, "finished_at": None}

def run_ingestion():
    JOB.update(state="running", started_at=now(), finished_at=None)
    try:
        subprocess.run([sys.executable, "src/crawl.py"], check=True)
        subprocess.run([sys.executable, "src/index.py"], check=True)
        JOB["state"] = "done"
    except Exception as e:
        JOB["state"] = f"failed: {e}"
    JOB["finished_at"] = now()

@app.post("/ingestion/run", dependencies=[Depends(require_key)])
def start_ingestion(bg: BackgroundTasks):
    if JOB["state"] == "running":
        raise HTTPException(409, "Ingestion already running")
    bg.add_task(run_ingestion)
    return {"state": "started"}

@app.get("/ingestion/status", dependencies=[Depends(require_key)])
def ingestion_status():
    counts = {}
    if os.path.exists(MANIFEST):
        for rec in json.load(open(MANIFEST, encoding="utf-8")).values():
            counts[rec.get("status")] = counts.get(rec.get("status"), 0) + 1
    return {"job": JOB, "manifest_counts": counts, "chunks_indexed": searchmod.col.count()}