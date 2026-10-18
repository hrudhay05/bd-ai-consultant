# Business Labs Capstone: AI Tech Consultant (Brilliant Directories)

Three connected projects built for the capstone. All customer emails and meetings are fictional or role-played. Email sending is simulated. No API keys are stored in this repository (each task uses its own `.env`, see `.env.example`).

## Contents
1. Overview and how the tasks connect
2. Requirements and run order
3. Task 1 - Knowledge Brain
4. Task 2 - Inbox Agent
5. Task 3 - Meeting to Scope
6. Evaluation summary (real numbers only)
7. Safety and reliability
8. Pending work
9. Known limits
10. Deliverables checklist

---

## 1. Overview

| Folder | Project | Stack | Status |
|---|---|---|---|
| `task1_knowledge_brain` | Knowledge Brain | Python, FastAPI | Done earlier |
| `task2_inbox_agent` | Inbox Agent | TypeScript, Node, Express, SQLite | Built and tested; some evaluation runs pending |
| `task3_meeting_to_scope` | Meeting to Scope | Python, Pydantic, SQLite | In progress |

Task 2 and Task 3 both call the Task 1 API (`POST /query`, header `X-API-Key`) for product evidence. If Task 1 is down, they report a clear failure state and invent nothing.

## 2. Requirements and run order
- Python 3.10+, Node.js 24, npm 11, Windows PowerShell (commands below are PowerShell)
- A free Groq API key. All three tasks share the free tier, which has a daily token limit per model (200,000 tokens per day for `openai/gpt-oss-120b`).

Run order:
1. Task 1 (own window):
```
cd task1_knowledge_brain
.venv\Scripts\activate
python -m uvicorn app.api:app --port 8000
```
2. Task 2 (second window):
```
cd task2_inbox_agent
npm install
npx tsx src\server.ts
```
Open http://localhost:3000.
3. Task 3: see section 5.

Each task: copy `.env.example` to `.env` and fill in the keys (Task 2 uses `PORT`, `KB_URL`, `KB_API_KEY`, `LLM_PROVIDER`, `GROQ_API_KEY`, `LLM_MODEL`).

---

## 3. Task 1 - Knowledge Brain
Answers product questions from Brilliant Directors support articles, with sources, and says so when evidence is insufficient.

API:
- `POST /query` with `{"question": "..."}` (at least 3 characters) and header `X-API-Key`.
- Response: `status` (`answered`, `insufficient_evidence`, `error`), `answer`, `sources` (title, url, relevance, images), `needs_human`, `reason`, `escalation_id`, `latency_ms`.

Checked from Task 2 and Task 3:
- "How do refunds work?" gave an answer with a source (relevance 0.728 in Task 2).
- A nonsense question gave `insufficient_evidence`.
- A 2-character question gave HTTP 422 (reported as `bad_request`).
- With Task 1 stopped, clients reported "unreachable" and invented nothing.
- In Task 3, one call gave `kb_error` because Task 1's own Groq call hit the daily limit.

Known limits: retrieval is not stable between runs for the same question; changelog articles can appear as evidence; 3 known failing Task 1 eval questions and 25 failed page crawls were not investigated; some Task 1 to-dos (pytest, scheduled refresh, rate-limit fix, frontend) are unconfirmed. Add any further Task 1 details from its own README.

---

## 4. Task 2 - Inbox Agent
Receives a customer email, classifies category, urgency, risk and injection, asks Task 1 for evidence, writes a safe draft, and lets a human review it.

### Pipeline
Email -> classifier -> Task 1 query (if the category needs evidence) -> drafter -> code guard -> SQLite -> review UI -> simulated send.

### Files
- `src/llm.ts`: the only file that calls Groq; retries on 429/5xx.
- `src/knowledge-client/client.ts`: typed Task 1 client (failure kinds: unreachable, timeout, unauthorized, bad_request, server_error, bad_response).
- `src/email/*`: zod schemas, dataset loader, classifier.
- `src/drafting/drafter.ts`, `guard.ts`: drafter (JSON validated with zod, up to 3 attempts, attempt log, selectable prompt version) and regex safety guard.
- `src/pipeline.ts`: connects the steps with timings.
- `src/feedback/db.ts`, `learning.ts`: SQLite, the 20-in-a-row counter, duplicate-send protection, audit log, prompt versions, regression gate, rollback.
- `src/server.ts`, `public/index.html`: Express API and review page.
- `src/evaluation/*`: classifier eval, draft eval (resumable), regression, held-out test.
- `tests/*`: guard test, simulations for the counter and learning module.

### Evidence modes
- ground (how-to, troubleshooting, follow-up): Task 1 facts may be used.
- background (refund, quote, project): context only, nothing may be promised.
- none (complaint): Task 1 is not called.
Changelog articles are filtered out, because they sound like a promise that something was fixed.

### Safety layers
Email text is untrusted (tagged in the prompt, shown as plain text in the UI). Injection forces high risk and needs_expert. Risk floors in code. Prompt rules 1-16. Regex guard (money, refund promises, "fixed" claims, time frames, vague speed, "logged/noted", fault/secure claims, password/card requests, internal source numbers, unknown links). Links are added by code from Task 1 sources only. A draft that fails the guard gets `guard_failed` and cannot be approved. Edited replies go through the same guard. Human approval is the default.

### The 20-in-a-row rule
- Counted per category. "Unmodified" means the final text equals the draft after trimming, unifying line endings, straight quotes and collapsing whitespace; clicking Approve alone is not enough.
- Counts only for approve + unmodified + guard passed. Resets on edit, reject, needs_expert or a failed guard, and a reset switches autonomy off.
- 20 makes a category eligible; it does not send by itself.
- Never autonomous: refund_cancellation, complaint, project_request, quote_request. Even for an enabled category a draft is auto-sent only if the guard passed, risk is not high, no injection, no needs_expert, and (ground mode) Task 1 answered.
- Switch per category, reversible, audit-logged. Duplicate-send protection by a unique key plus one review per draft.

### Feedback and improvement
Reviewer reasons are stored; repeated reasons are found; a candidate prompt version goes live only after the fixed 10-email regression set passes and is not worse than the active version; rollback restores the previous version.

### Run tests
```
npx tsc --noEmit
npx tsx tests\guard-test.ts
npx tsx tests\db-test.ts            # simulation
npx tsx tests\learning-test.ts      # simulation
npx tsx src\evaluation\classify-eval.ts
npx tsx src\evaluation\draft-eval.ts --model openai/gpt-oss-20b
npx tsx src\evaluation\draft-eval.ts --resume
npx tsx src\evaluation\regression.ts --version draft-v3
npx tsx src\evaluation\test-eval.ts --confirm      # held-out split, run ONCE
```
Run only one Groq job per day.

Task 2 documents: `task2_inbox_agent/README.md`, `DESIGN.md`, `EVALS.md`, `AI_LOG.md`.

---

## 5. Task 3 - Meeting to Scope
Turns role-played client meetings into requirements, scope of work, hour estimates and a proposal; compares a follow-up meeting against the approved baseline; requires human approval before anything is "sent".

### Planned agent team
Transcript Analyst, Product Feasibility Agent (calls Task 1), Scope Agent, Estimation Agent (low, likely, high hours), Proposal and Review Agent.

### Done and tested
- Setup (Python 3.10, own venv, packages, `.env`).
- Task 1 client (`kb_client.py`): answered, `bad_request` for a 2-character question, `kb_error` when Task 1 hit its Groq limit.
- Transcripts (role-played): A (2026-10-12, 55 turns), B (2026-10-14, 42 turns), C (follow-up to A, 31 turns).
- Staged chunking: 20 turns per chunk, 5 overlap (A: 4 chunks, B: 3, C: 2).
- Pydantic models: Requirement, Evidence, EstimateTask, ScopeVersion, ChangeReport, Approval.
- SQLite storage and send gate: a draft cannot be sent or approved; pending cannot be sent; an empty reviewer is refused; an approved version can be sent (simulated); an unapproved revision is blocked; the baseline stays on v1 until v2 is approved (all tests passed).
- Groq client: retries, daily-limit stop, token log, disk cache (smoke test 117 prompt + 60 completion tokens, second call served from cache).
- Quote check in code: a real quote passes; a fake quote, wrong timestamp and too-short quote fail.

### Transcript Analyst on Meeting A (gpt-oss-20b)
| Run | Result |
|---|---|
| 1 | Incomplete: chunk A-C02 failed (HTTP 400 JSON validation). 6 requirements. One real requirement was wrongly rejected by an exact quote-mark comparison. |
| 2 | Complete after fixing `llm.py` and the quote check: 11 requirements, 2 constraints, 2 open questions, 2 commitments, 0 rejected. |
| 3 | Complete with a stricter prompt: 13 requirements, 8 constraints, 3 open questions, 6 commitments, 0 rejected; 4 calls, 8,248 tokens, about 6.4 s API time. |
Known problems after run 3: REQ-010 to REQ-013 repeat the consultant's summary line; REQ-005 is a dependency; "improved mobile experience" is marked confirmed although the client was vague; two lines may be uncited; one request line is listed as a commitment. `cleanup.py` (code only) is written to address these and has not been checked yet.

### Not done yet
Extraction for B and C, feasibility check through Task 1, scope, estimation and proposal agents, follow-up comparison against the approved baseline, full review UI, 20 evaluation cases with a dev/test split, 120b vs 20b comparison, Task 3 README, DESIGN, EVALS, AI_LOG.

---

## 6. Evaluation summary (real numbers only)

Task 2, dev split (41 emails):
| Item | Result |
|---|---|
| Classifier classify-v2 (gpt-oss-120b) | category 39/41, urgency 26/41, risk 36/41, 0 failures |
| Drafts, gpt-oss-20b | 41/41 completed, guard passed 37, first try 24, average 11.7 s, max 27 s |
| Drafts, gpt-oss-120b | 36/41 completed (Groq daily limit stopped the rest), guard passed 35, first try 7 |
| Same 36 emails | 120b: 35 passed, 7 first try, 18.5 s; 20b: 32 passed, 19 first try, 12.0 s |
| Cost | $0 on the Groq free tier |

Notes: "guard passed" is not a quality score. 120b times include rate-limit waits, so speed is not a fair comparison. Counter (7/7) and learning (5/5) tests are simulations. In the real review page, one draft was approved unmodified (streak 1/20) and a `blocked_kb_unavailable` case was shown.

Task 3: no evaluation cases have been run yet, so there are no accuracy numbers.

## 7. Safety and reliability
- Untrusted text handling (emails and transcripts shown as plain text).
- Guard on drafts and edits; quote verification in code for Task 3.
- Clear failure states: `blocked_kb_unavailable`, `classify_failed`, `draft_failed`, `guard_failed`, `kb_error`.
- Resumable evaluation runs that stop cleanly on the Groq daily limit.
- Human approval required before sending; duplicate-send and unapproved-version protection.

## 8. Pending work
- Task 2: held-out test (attempted once, stopped at the first email by the Groq daily limit, nothing seen), regression baseline, manual quality scoring, demo video.
- Task 3: everything listed under "Not done yet".
- Final demo video (max 10 minutes, all three tasks, one failure case).

## 9. Known limits
- Hand-written labels; urgency low vs normal is fuzzy; transcripts are role-played and short.
- Regex and quote checks cannot detect every invented statement or invented step.
- Task 1 retrieval varies between runs.
- Injection patterns were written while looking at one email (RC-06).
- Email bodies are stored unredacted in the local Task 2 database.
- Task 3 extraction quality was measured on one meeting only.
- Per-email 20b drafts from the full Task 2 run were overwritten (only summary numbers kept).
- Meeting C is dated 2026-10-26, which is later than the other meetings and the date of these notes; it is a role-played date.

## 10. Deliverables checklist
- [x] Task 2 code, README, DESIGN, EVALS, AI_LOG (pending items marked)
- [ ] Task 3 code complete, README, DESIGN, EVALS, AI_LOG
- [ ] Held-out test, regression run, manual scoring
- [ ] Demo video
- [x] GitHub repository (push the whole folder; keep it private until secrets are checked)
