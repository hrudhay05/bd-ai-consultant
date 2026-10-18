import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";

fs.mkdirSync("data", { recursive: true });
export const db = new Database(process.env.DB_FILE ?? "data/inbox.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY, from_name TEXT, from_email TEXT, subject TEXT, body TEXT, received_at TEXT
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL, status TEXT NOT NULL,
  category TEXT, urgency TEXT, risk TEXT, injection INTEGER DEFAULT 0,
  evidence_mode TEXT, kb_status TEXT, sources_json TEXT,
  reply_subject TEXT, reply_body TEXT, needs_expert INTEGER DEFAULT 0,
  guard_passed INTEGER, guard_violations TEXT, attempts INTEGER,
  model TEXT, classifier_version TEXT, drafter_version TEXT,
  latency_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL, action TEXT NOT NULL,
  final_body TEXT, modified INTEGER, reason TEXT, reviewer TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS sent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL, email_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  body TEXT, simulated INTEGER DEFAULT 1, sent_at TEXT
);
CREATE TABLE IF NOT EXISTS category_stats (
  category TEXT PRIMARY KEY, consecutive_unmodified INTEGER DEFAULT 0,
  autonomy_enabled INTEGER DEFAULT 0, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, event TEXT, draft_id INTEGER, detail TEXT
);
`);

export const THRESHOLD = 20;
// Categories that can NEVER be autonomous, even at 20.
export const LOCKED_CATEGORIES = ["refund_cancellation", "complaint", "project_request", "quote_request"];

const now = () => new Date().toISOString();

export function audit(event: string, draftId: number | null, detail: unknown) {
  db.prepare("INSERT INTO audit_log (at,event,draft_id,detail) VALUES (?,?,?,?)")
    .run(now(), event, draftId, JSON.stringify(detail));
}

/** Unmodified rule: after trimming, unifying line endings, curly->straight quotes
 *  and collapsing whitespace, the two texts must be exactly equal (case-sensitive). */
export function normalize(t: string): string {
  return t
    .replace(/\r\n/g, "\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function saveEmail(e: { id: string; from_name: string; from_email: string; subject: string; body: string }) {
  db.prepare("INSERT OR REPLACE INTO emails (id,from_name,from_email,subject,body,received_at) VALUES (?,?,?,?,?,?)")
    .run(e.id, e.from_name, e.from_email, e.subject, e.body, now());
}

export function saveDraft(p: {
  email_id: string; status: string; category?: string; urgency?: string; risk?: string;
  injection?: boolean; evidence_mode?: string; kb_status?: string; sources?: unknown;
  reply_subject?: string; reply_body?: string; needs_expert?: boolean;
  guard_passed?: boolean; guard_violations?: string[]; attempts?: number;
  model?: string; classifier_version?: string; drafter_version?: string;
  latency_ms?: number; tokens_in?: number; tokens_out?: number;
}): number {
  const r = db.prepare(`INSERT INTO drafts (email_id,status,category,urgency,risk,injection,evidence_mode,kb_status,sources_json,
    reply_subject,reply_body,needs_expert,guard_passed,guard_violations,attempts,model,classifier_version,drafter_version,
    latency_ms,tokens_in,tokens_out,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    p.email_id, p.status, p.category ?? null, p.urgency ?? null, p.risk ?? null, p.injection ? 1 : 0,
    p.evidence_mode ?? null, p.kb_status ?? null, JSON.stringify(p.sources ?? []),
    p.reply_subject ?? null, p.reply_body ?? null, p.needs_expert ? 1 : 0,
    p.guard_passed === undefined ? null : p.guard_passed ? 1 : 0, JSON.stringify(p.guard_violations ?? []),
    p.attempts ?? null, p.model ?? null, p.classifier_version ?? null, p.drafter_version ?? null,
    p.latency_ms ?? null, p.tokens_in ?? null, p.tokens_out ?? null, now());
  const id = Number(r.lastInsertRowid);
  audit("draft_created", id, { email_id: p.email_id, status: p.status, category: p.category }); // no email text in audit
  return id;
}

export type ReviewAction = "approve" | "edit" | "reject" | "needs_expert";

/** Records a review, updates the counter, and (for approve/edit) does the simulated send once. */
export function recordReview(draftId: number, action: ReviewAction, finalBody: string | null, reason: string | null, reviewer = "reviewer") {
  const tx = db.transaction(() => {
    const d = db.prepare("SELECT * FROM drafts WHERE id=?").get(draftId) as any;
    if (!d) throw new Error("draft not found");
    if (db.prepare("SELECT 1 FROM reviews WHERE draft_id=?").get(draftId)) throw new Error("draft already reviewed");

    const sends = action === "approve" || action === "edit";
    const text = sends ? (action === "approve" ? d.reply_body : (finalBody ?? "")) : null;
    if (sends && !text) throw new Error("empty final text");
    const modified = sends ? normalize(text!) !== normalize(d.reply_body ?? "") : true;

    db.prepare("INSERT INTO reviews (draft_id,action,final_body,modified,reason,reviewer,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(draftId, action, text, modified ? 1 : 0, reason, reviewer, now());

    // Counter: only a guard-passed approval with an unmodified text counts.
    const counts = action === "approve" && !modified && d.guard_passed === 1 && d.status === "draft_ready";
    db.prepare("INSERT OR IGNORE INTO category_stats (category,updated_at) VALUES (?,?)").run(d.category, now());
    if (counts) db.prepare("UPDATE category_stats SET consecutive_unmodified=consecutive_unmodified+1, updated_at=? WHERE category=?").run(now(), d.category);
    else db.prepare("UPDATE category_stats SET consecutive_unmodified=0, autonomy_enabled=0, updated_at=? WHERE category=?").run(now(), d.category);

    if (sends) {
      const key = crypto.createHash("sha256").update(d.email_id + "|" + normalize(text!)).digest("hex");
      try {
        db.prepare("INSERT INTO sent_messages (draft_id,email_id,idempotency_key,body,simulated,sent_at) VALUES (?,?,?,?,1,?)")
          .run(draftId, d.email_id, key, text, now());
      } catch {
        throw new Error("duplicate send blocked");
      }
    }
    audit("review_" + action, draftId, { modified, counts, reason_given: !!reason });
    return { modified, counts };
  });
  return tx();
}

export function eligibility(category: string) {
  const s = db.prepare("SELECT * FROM category_stats WHERE category=?").get(category) as any;
  const streak = s?.consecutive_unmodified ?? 0;
  const locked = LOCKED_CATEGORIES.includes(category);
  return { category, streak, eligible: streak >= THRESHOLD && !locked, locked, autonomy_enabled: !!s?.autonomy_enabled };
}

/** Per-draft safety: a draft may be auto-sent only if everything here is true. */
export function mayAutoSend(draftId: number): { ok: boolean; why: string } {
  const d = db.prepare("SELECT * FROM drafts WHERE id=?").get(draftId) as any;
  if (!d) return { ok: false, why: "no such draft" };
  const e = eligibility(d.category);
  if (!e.autonomy_enabled) return { ok: false, why: "autonomy switch is off" };
  if (!e.eligible) return { ok: false, why: "category not eligible (streak/locked)" };
  if (d.status !== "draft_ready" || d.guard_passed !== 1) return { ok: false, why: "guard not passed" };
  if (d.risk === "high" || d.injection === 1 || d.needs_expert === 1) return { ok: false, why: "high risk / injection / needs expert" };
  if (d.evidence_mode === "ground" && d.kb_status !== "answered") return { ok: false, why: "no evidence from Task 1" };
  return { ok: true, why: "all checks passed" };
}

export function setAutonomy(category: string, on: boolean) {
  if (on && !eligibility(category).eligible) throw new Error("category is not eligible");
  db.prepare("INSERT OR IGNORE INTO category_stats (category,updated_at) VALUES (?,?)").run(category, now());
  db.prepare("UPDATE category_stats SET autonomy_enabled=?, updated_at=? WHERE category=?").run(on ? 1 : 0, now(), category);
  audit(on ? "autonomy_on" : "autonomy_off", null, { category });
}