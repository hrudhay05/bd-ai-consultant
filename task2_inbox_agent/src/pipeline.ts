import { classifyEmail, CLASSIFIER_PROMPT_VERSION, type Classification } from "./email/classifier.js";
import type { Category } from "./email/types.js";
import { queryKnowledge, type KbSource } from "./knowledge-client/client.js";
import { generateDraft, DRAFT_PROMPT_VERSION, type Draft, type DraftMeta, type EvidenceMode } from "./drafting/drafter.js";
import type { GuardResult } from "./drafting/guard.js";

export interface InboundEmail {
  from_name: string;
  subject: string;
  body: string;
}

export type PipelineStatus = "draft_ready" | "blocked_kb_unavailable" | "classify_failed" | "draft_failed";

export interface PipelineOutput {
  status: PipelineStatus;
  classification?: Classification;
  kb: { called: boolean; ok: boolean; status?: string; failure?: string; sources: KbSource[] };
  evidence_mode: EvidenceMode;
  draft?: Draft;
  guard?: GuardResult;
  draft_meta?: DraftMeta;
  human_approval_required: true; // always true for now; autonomy is added later
  notes: string[];
  versions: { classifier: string; drafter: string; model: string };
  timing: { classify_ms: number; kb_ms: number; draft_ms: number };
  total_latency_ms: number;
}

const EVIDENCE_MODE: Record<Category, EvidenceMode> = {
  how_to: "ground",
  troubleshooting: "ground",
  follow_up: "ground",
  refund_cancellation: "background",
  quote_request: "background",
  project_request: "background",
  complaint: "none",
};

export async function processEmail(email: InboundEmail, model?: string): Promise<PipelineOutput> {
  const started = Date.now();
  const notes: string[] = [];
  const timing = { classify_ms: 0, kb_ms: 0, draft_ms: 0 };
  const usedModel = model ?? process.env.LLM_MODEL ?? "unknown";
  const versions = { classifier: CLASSIFIER_PROMPT_VERSION, drafter: DRAFT_PROMPT_VERSION, model: usedModel };
  const kb: PipelineOutput["kb"] = { called: false, ok: false, sources: [] };
  const finish = (partial: Partial<PipelineOutput> & { status: PipelineStatus; evidence_mode: EvidenceMode }): PipelineOutput => ({
    kb,
    human_approval_required: true,
    notes,
    versions,
    timing,
    total_latency_ms: Date.now() - started,
    ...partial,
  });

  // 1. Classify
  let t = Date.now();
  const cls = await classifyEmail(email, model);
  timing.classify_ms = Date.now() - t;
  if (!cls.ok) {
    notes.push(cls.error);
    return finish({ status: "classify_failed", evidence_mode: "none" });
  }
  const c = cls.result;
  if (c.injection_suspected) notes.push("Prompt injection suspected: instructions inside the email were ignored.");

  // 2. Knowledge service
  const mode = EVIDENCE_MODE[c.category];
  let kbResponse = null;
  if (mode !== "none") {
    kb.called = true;
    t = Date.now();
    const r = await queryKnowledge(`${email.subject}. ${c.summary}`.slice(0, 500));
    timing.kb_ms = Date.now() - t;
    if (r.ok) {
      kb.ok = true;
      kb.status = r.data.status;
      // Changelog articles describe past fixes, so they are not used as evidence.
      const usable = r.data.sources.filter((s) => !/^changelog/i.test(s.title));
      const onlyChangelog = r.data.sources.length > 0 && usable.length === 0;
      kb.sources = usable;
      if (onlyChangelog) {
        notes.push("Knowledge service returned only changelog articles. They describe past fixes, so they were not used as evidence.");
        kbResponse = null;
      } else {
        kbResponse = { ...r.data, sources: usable };
      }
      if (r.data.status !== "answered") notes.push(`Knowledge service had no sufficient evidence (${r.data.reason ?? "no reason given"}).`);
    } else {
      kb.failure = `${r.kind}: ${r.message}`;
      notes.push(`Knowledge service failed: ${kb.failure}`);
      if (mode === "ground") {
        notes.push("No draft created, because this email needs evidence and none is available. A human must write the reply.");
        return finish({ status: "blocked_kb_unavailable", classification: c, evidence_mode: mode });
      }
    }
  }

  // 3. Draft + code checks
  t = Date.now();
  const d = await generateDraft({ email, classification: c, kb: kbResponse }, mode, model);
  timing.draft_ms = Date.now() - t;
  if (!d.ok) {
    notes.push(d.error);
    return finish({ status: "draft_failed", classification: c, evidence_mode: mode });
  }
  if (!d.guard.passed) notes.push(`Draft failed code checks: ${d.guard.violations.join("; ")}`);
  if (d.draft.needs_expert) notes.push("Draft asks for expert help.");
  if (c.urgency === "urgent" || c.injection_suspected) {
    if (!d.draft.needs_expert) notes.push("Marked as needing an expert by a code rule (urgent or injection suspected).");
    d.draft.needs_expert = true;
  }
  return finish({ status: "draft_ready", classification: c, evidence_mode: mode, draft: d.draft, guard: d.guard, draft_meta: d.meta });
}