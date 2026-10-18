import { db, audit } from "./db.js";

db.exec(`
CREATE TABLE IF NOT EXISTS prompt_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  extra_rules TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  note TEXT, created_at TEXT, activated_at TEXT
);
CREATE TABLE IF NOT EXISTS regression_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL, passed INTEGER, total INTEGER, details_json TEXT, created_at TEXT
);
`);
const now = () => new Date().toISOString();
db.prepare("INSERT OR IGNORE INTO prompt_versions (version,extra_rules,status,note,created_at,activated_at) VALUES ('draft-v3','','active','baseline',?,?)").run(now(), now());

/** Corrections that repeat: same category and same reviewer reason, at least minCount times. */
export function recurringCorrections(minCount = 2) {
  return db.prepare(`SELECT d.category AS category, lower(trim(r.reason)) AS reason, COUNT(*) AS times
    FROM reviews r JOIN drafts d ON d.id = r.draft_id
    WHERE r.action IN ('edit','reject') AND r.reason IS NOT NULL AND trim(r.reason) <> ''
    GROUP BY d.category, lower(trim(r.reason)) HAVING COUNT(*) >= ? ORDER BY times DESC`).all(minCount);
}

export function addCandidate(version: string, extraRules: string, note: string) {
  db.prepare("INSERT INTO prompt_versions (version,extra_rules,status,note,created_at) VALUES (?,?,'candidate',?,?)")
    .run(version, extraRules, note, now());
  audit("prompt_candidate_added", null, { version, note });
}

export function recordRegression(version: string, passed: number, total: number, details: unknown) {
  db.prepare("INSERT INTO regression_runs (version,passed,total,details_json,created_at) VALUES (?,?,?,?,?)")
    .run(version, passed, total, JSON.stringify(details), now());
  audit("regression_run", null, { version, passed, total });
}

export function activeVersion() {
  return db.prepare("SELECT * FROM prompt_versions WHERE status='active'").get() as any;
}

function lastRun(version: string) {
  return db.prepare("SELECT * FROM regression_runs WHERE version=? ORDER BY id DESC LIMIT 1").get(version) as any;
}

/** A candidate goes live only if it passed every regression case and is not worse than the active version. */
export function activate(version: string) {
  const tx = db.transaction(() => {
    const cand = db.prepare("SELECT * FROM prompt_versions WHERE version=?").get(version) as any;
    if (!cand) throw new Error("unknown version");
    const run = lastRun(version);
    if (!run) throw new Error("no regression run for this version");
    if (run.passed !== run.total) throw new Error(`regression failed: ${run.passed}/${run.total}`);
    const cur = activeVersion();
    const curRun = cur ? lastRun(cur.version) : null;
    if (curRun && run.passed < curRun.passed) throw new Error("candidate is worse than the active version");
    if (cur) db.prepare("UPDATE prompt_versions SET status='superseded' WHERE id=?").run(cur.id);
    db.prepare("UPDATE prompt_versions SET status='active', activated_at=? WHERE id=?").run(now(), cand.id);
    audit("prompt_activated", null, { version, from: cur?.version });
  });
  tx();
}

export function rollback(reason: string) {
  const tx = db.transaction(() => {
    const cur = activeVersion();
    const prev = db.prepare("SELECT * FROM prompt_versions WHERE status='superseded' ORDER BY activated_at DESC, id DESC LIMIT 1").get() as any;
    if (!cur || !prev) throw new Error("nothing to roll back to");
    db.prepare("UPDATE prompt_versions SET status='rolled_back' WHERE id=?").run(cur.id);
    db.prepare("UPDATE prompt_versions SET status='active', activated_at=? WHERE id=?").run(now(), prev.id);
    audit("prompt_rollback", null, { from: cur.version, to: prev.version, reason });
  });
  tx();
}