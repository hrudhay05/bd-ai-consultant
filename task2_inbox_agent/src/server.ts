import "dotenv/config";
import express from "express";
import path from "node:path";
import { loadDataset } from "./email/dataset.js";
import { processEmail } from "./pipeline.js";
import { checkDraft } from "./drafting/guard.js";
import { setPromptVersion, currentPromptVersion } from "./drafting/drafter.js";
import { activeVersion } from "./feedback/learning.js";
import {
  db, saveEmail, saveDraft, recordReview, eligibility, setAutonomy, mayAutoSend, audit, THRESHOLD,
} from "./feedback/db.js";

const CATEGORIES = [
  "how_to", "troubleshooting", "project_request", "refund_cancellation",
  "complaint", "quote_request", "follow_up",
];
const model = process.env.LLM_MODEL ?? "openai/gpt-oss-120b";
const dev = loadDataset("dev"); // held-out test split is never loaded here
const av = activeVersion();
setPromptVersion(av.version, av.extra_rules);
console.log("Drafting prompt version:", av.version);
const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/api/emails", (_req, res) => {
  res.json(dev.map((e) => ({ id: e.id, subject: e.subject, from_name: e.from_name })));
});

app.get("/api/drafts", (_req, res) => {
  const rows = db.prepare(`SELECT d.id, d.email_id, d.status, d.category, d.risk, d.created_at, r.action AS review_action
    FROM drafts d LEFT JOIN reviews r ON r.draft_id = d.id ORDER BY d.id DESC LIMIT 50`).all();
  res.json(rows);
});

app.get("/api/drafts/:id", (req, res) => {
  const d = db.prepare("SELECT * FROM drafts WHERE id=?").get(Number(req.params.id)) as any;
  if (!d) return res.status(404).json({ error: "draft not found" });
  const email = db.prepare("SELECT * FROM emails WHERE id=?").get(d.email_id);
  const review = db.prepare("SELECT action, modified, reason, created_at FROM reviews WHERE draft_id=?").get(d.id);
  res.json({
    ...d,
    sources: JSON.parse(d.sources_json ?? "[]"),
    guard_violations: JSON.parse(d.guard_violations ?? "[]"),
    email, review: review ?? null,
  });
});

app.post("/api/process", async (req, res) => {
  const id = String(req.body?.email_id ?? "");
  const e = dev.find((x) => x.id === id);
  if (!e) return res.status(404).json({ error: "unknown email id" });
  try {
    saveEmail(e);
    const out: any = await processEmail(e, model);
    let status: string = out.status;
    if (out.draft && out.guard && !out.guard.passed) status = "guard_failed";
    const draftId = saveDraft({
      email_id: e.id,
      status,
      category: out.classification?.category,
      urgency: out.classification?.urgency,
      risk: out.classification?.risk,
      injection: out.classification?.injection_suspected,
      evidence_mode: out.evidence_mode,
      kb_status: out.kb?.status ?? out.kb?.failure,
      sources: out.kb?.sources ?? [],
      reply_subject: out.draft?.reply_subject,
      reply_body: out.draft?.reply_body,
      needs_expert: out.draft?.needs_expert,
      guard_passed: out.guard?.passed,
      guard_violations: out.guard?.violations ?? [],
      attempts: out.draft_meta?.attempts,
      model,
      classifier_version: "classify-v2",
      drafter_version: currentPromptVersion(),
      latency_ms: out.total_latency_ms,
      tokens_in: out.draft_meta?.promptTokens,
      tokens_out: out.draft_meta?.completionTokens,
    });
    // Autonomy: only if the switch is on AND every per-draft check passes.
    let auto_sent = false;
    const decision = mayAutoSend(draftId);
    if (decision.ok) {
      recordReview(draftId, "approve", null, "autonomous send", "autonomous");
      auto_sent = true;
    }
    audit("autonomy_decision", draftId, { auto_sent, why: decision.why });
    res.json({ draft_id: draftId, status, auto_sent, why: decision.why });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.post("/api/drafts/:id/review", (req, res) => {
  const id = Number(req.params.id);
  const action = String(req.body?.action ?? "");
  const finalBody = req.body?.final_body ? String(req.body.final_body) : null;
  const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : null;
  if (!["approve", "edit", "reject", "needs_expert"].includes(action)) {
    return res.status(400).json({ error: "unknown action" });
  }
    const d = db.prepare("SELECT status, sources_json FROM drafts WHERE id=?").get(id) as any;
  if (!d) return res.status(404).json({ error: "draft not found" });
  if (action === "approve" && d.status !== "draft_ready") {
    return res.status(400).json({ error: "this draft did not pass all checks. Use Edit & send, Reject or Needs expert." });
  }
  if ((action === "edit" || action === "reject") && !reason) {
    return res.status(400).json({ error: "please write a short reason for the correction" });
  }
  try {
      if (action === "edit") {
    if (!finalBody) return res.status(400).json({ error: "the edited reply is empty" });
    const urls = (JSON.parse(d.sources_json ?? "[]") as any[]).map((s) => s.url);
    const g = checkDraft(finalBody, urls);
    if (!g.passed) {
      audit("edit_blocked_by_guard", id, { violations: g.violations });
      return res.status(400).json({ error: "The edited reply broke safety rules: " + g.violations.join("; ") + ". Please change the text." });
    }
  }
    const r = recordReview(id, action as any, finalBody, reason);
    res.json({ ok: true, ...r });
  } catch (err: any) {
    res.status(409).json({ error: String(err?.message ?? err) });
  }
});

app.get("/api/stats", (_req, res) => {
  res.json({ threshold: THRESHOLD, categories: CATEGORIES.map((c) => eligibility(c)) });
});

app.post("/api/autonomy", (req, res) => {
  try {
    setAutonomy(String(req.body?.category), !!req.body?.on);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err) });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Review UI: http://localhost:${port}`));

