import sqlite3
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from app.models import Meeting, ScopeVersion, Approval

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "task3.db"


class SendBlocked(Exception):
    pass


class InvalidTransition(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def conn(db_path: Optional[Path] = None) -> sqlite3.Connection:
    p = Path(db_path) if db_path else DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p))
    c.row_factory = sqlite3.Row
    return c


def init_db(db_path: Optional[Path] = None) -> None:
    c = conn(db_path)
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
            project_id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS meetings (
            meeting_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, date TEXT NOT NULL,
            file_path TEXT NOT NULL, sha256 TEXT NOT NULL, added_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS versions (
            project_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL,
            based_on_version INTEGER, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, version));
        CREATE TABLE IF NOT EXISTS approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, version INTEGER NOT NULL,
            reviewer TEXT NOT NULL, decision TEXT NOT NULL, timestamp TEXT NOT NULL, note TEXT);
        CREATE TABLE IF NOT EXISTS sends (
            id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, version INTEGER NOT NULL,
            timestamp TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, project_id TEXT,
            action TEXT NOT NULL, detail TEXT);
        """
    )
    c.commit()
    c.close()


def audit(c: sqlite3.Connection, project_id: str, action: str, detail: str = "") -> None:
    c.execute(
        "INSERT INTO audit_log (timestamp, project_id, action, detail) VALUES (?,?,?,?)",
        (now(), project_id, action, detail),
    )


def create_project(project_id: str, name: str, db_path: Optional[Path] = None) -> None:
    c = conn(db_path)
    c.execute(
        "INSERT OR IGNORE INTO projects (project_id, name, created_at) VALUES (?,?,?)",
        (project_id, name, now()),
    )
    audit(c, project_id, "project_created", name)
    c.commit()
    c.close()


def project_exists(project_id: str, db_path: Optional[Path] = None) -> bool:
    c = conn(db_path)
    row = c.execute("SELECT 1 FROM projects WHERE project_id=?", (project_id,)).fetchone()
    c.close()
    return row is not None


def add_meeting(m: Meeting, db_path: Optional[Path] = None) -> None:
    c = conn(db_path)
    if not c.execute("SELECT 1 FROM projects WHERE project_id=?", (m.project_id,)).fetchone():
        c.close()
        raise ValueError("Unknown project: " + m.project_id)
    c.execute(
        "INSERT OR REPLACE INTO meetings (meeting_id, project_id, date, file_path, sha256, added_at) VALUES (?,?,?,?,?,?)",
        (m.meeting_id, m.project_id, m.date, m.file_path, m.sha256, now()),
    )
    audit(c, m.project_id, "meeting_added", m.meeting_id + " " + m.date)
    c.commit()
    c.close()


def list_meetings(project_id: str, db_path: Optional[Path] = None) -> List[dict]:
    c = conn(db_path)
    rows = c.execute("SELECT * FROM meetings WHERE project_id=? ORDER BY date", (project_id,)).fetchall()
    c.close()
    return [dict(r) for r in rows]


def next_version_number(c: sqlite3.Connection, project_id: str) -> int:
    row = c.execute("SELECT MAX(version) AS v FROM versions WHERE project_id=?", (project_id,)).fetchone()
    return (row["v"] or 0) + 1


def save_version(sv: ScopeVersion, db_path: Optional[Path] = None) -> int:
    """Saves a NEW draft version. Existing versions are never overwritten."""
    c = conn(db_path)
    n = next_version_number(c, sv.project_id)
    sv.version = n
    sv.state = "draft"
    sv.created_at = now()
    c.execute(
        "INSERT INTO versions (project_id, version, state, based_on_version, data_json, created_at) VALUES (?,?,?,?,?,?)",
        (sv.project_id, n, sv.state, sv.based_on_version, sv.model_dump_json(), sv.created_at),
    )
    audit(c, sv.project_id, "version_saved", "v" + str(n))
    c.commit()
    c.close()
    return n


def update_draft(sv: ScopeVersion, db_path: Optional[Path] = None) -> None:
    """Updates a version only while it is a draft (for example after estimates are added)."""
    c = conn(db_path)
    row = c.execute(
        "SELECT state FROM versions WHERE project_id=? AND version=?", (sv.project_id, sv.version)
    ).fetchone()
    if row is None:
        c.close()
        raise ValueError("Version not found")
    if row["state"] != "draft":
        c.close()
        raise InvalidTransition("Only a draft can be changed. Current state: " + row["state"])
    sv.state = "draft"
    c.execute(
        "UPDATE versions SET data_json=? WHERE project_id=? AND version=?",
        (sv.model_dump_json(), sv.project_id, sv.version),
    )
    audit(c, sv.project_id, "draft_updated", "v" + str(sv.version))
    c.commit()
    c.close()


def get_version(project_id: str, version: int, db_path: Optional[Path] = None) -> Optional[ScopeVersion]:
    c = conn(db_path)
    row = c.execute(
        "SELECT state, data_json FROM versions WHERE project_id=? AND version=?", (project_id, version)
    ).fetchone()
    c.close()
    if row is None:
        return None
    sv = ScopeVersion.model_validate_json(row["data_json"])
    sv.state = row["state"]  # the state column is the truth
    return sv


def list_versions(project_id: str, db_path: Optional[Path] = None) -> List[dict]:
    c = conn(db_path)
    rows = c.execute(
        "SELECT version, state, based_on_version, created_at FROM versions WHERE project_id=? ORDER BY version",
        (project_id,),
    ).fetchall()
    c.close()
    return [dict(r) for r in rows]


def latest_approved(project_id: str, db_path: Optional[Path] = None) -> Optional[ScopeVersion]:
    c = conn(db_path)
    row = c.execute(
        "SELECT version FROM versions WHERE project_id=? AND state='approved' ORDER BY version DESC LIMIT 1",
        (project_id,),
    ).fetchone()
    c.close()
    return get_version(project_id, row["version"], db_path) if row else None


def submit_for_approval(project_id: str, version: int, db_path: Optional[Path] = None) -> None:
    c = conn(db_path)
    row = c.execute("SELECT state FROM versions WHERE project_id=? AND version=?", (project_id, version)).fetchone()
    if row is None:
        c.close()
        raise ValueError("Version not found")
    if row["state"] != "draft":
        c.close()
        raise InvalidTransition("Only a draft can be submitted. Current state: " + row["state"])
    c.execute("UPDATE versions SET state='pending_approval' WHERE project_id=? AND version=?", (project_id, version))
    audit(c, project_id, "submitted_for_approval", "v" + str(version))
    c.commit()
    c.close()


def review(project_id: str, version: int, reviewer: str, decision: str, note: str = "",
           db_path: Optional[Path] = None) -> Approval:
    if decision not in ("approved", "rejected"):
        raise ValueError("decision must be approved or rejected")
    if not reviewer or not reviewer.strip():
        raise ValueError("A reviewer name is required")
    c = conn(db_path)
    row = c.execute("SELECT state FROM versions WHERE project_id=? AND version=?", (project_id, version)).fetchone()
    if row is None:
        c.close()
        raise ValueError("Version not found")
    if row["state"] != "pending_approval":
        c.close()
        raise InvalidTransition("Only a pending_approval version can be reviewed. Current state: " + row["state"])
    ts = now()
    c.execute(
        "INSERT INTO approvals (project_id, version, reviewer, decision, timestamp, note) VALUES (?,?,?,?,?,?)",
        (project_id, version, reviewer.strip(), decision, ts, note),
    )
    c.execute("UPDATE versions SET state=? WHERE project_id=? AND version=?", (decision, project_id, version))
    if decision == "approved":
        # older approved versions become superseded, so there is one current baseline
        c.execute(
            "UPDATE versions SET state='superseded' WHERE project_id=? AND state='approved' AND version<>?",
            (project_id, version),
        )
    audit(c, project_id, "review_" + decision, "v" + str(version) + " by " + reviewer.strip())
    c.commit()
    c.close()
    return Approval(project_id=project_id, version=version, reviewer=reviewer.strip(),
                    decision=decision, timestamp=ts, note=note)


def simulate_send(project_id: str, version: int, db_path: Optional[Path] = None) -> str:
    """SIMULATED send. Nothing leaves this computer. Refuses anything not approved."""
    c = conn(db_path)
    row = c.execute("SELECT state FROM versions WHERE project_id=? AND version=?", (project_id, version)).fetchone()
    if row is None:
        c.close()
        raise ValueError("Version not found")
    appr = c.execute(
        "SELECT 1 FROM approvals WHERE project_id=? AND version=? AND decision='approved'",
        (project_id, version),
    ).fetchone()
    if row["state"] != "approved" or appr is None:
        audit(c, project_id, "send_blocked", "v" + str(version) + " state=" + row["state"])
        c.commit()
        c.close()
        raise SendBlocked("Version " + str(version) + " is '" + row["state"] + "'. Only an approved version can be sent.")
    ts = now()
    c.execute("INSERT INTO sends (project_id, version, timestamp, simulated) VALUES (?,?,?,1)", (project_id, version, ts))
    audit(c, project_id, "send_simulated", "v" + str(version))
    c.commit()
    c.close()
    return ts


def audit_trail(project_id: str, db_path: Optional[Path] = None) -> List[dict]:
    c = conn(db_path)
    rows = c.execute("SELECT * FROM audit_log WHERE project_id=? ORDER BY id", (project_id,)).fetchall()
    c.close()
    return [dict(r) for r in rows]