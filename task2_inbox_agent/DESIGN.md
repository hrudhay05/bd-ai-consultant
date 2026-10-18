# DESIGN.md - Task 2: Inbox Agent (Brilliant Directories)

## 1. Goal
Receive a customer email, classify it, collect evidence from the Task 1 Knowledge Brain, write a safe draft reply, and let a human review it. The system never invents refunds, prices, delivery dates, or fixes. Sending is simulated.

## 2. Architecture
Email -> classifier -> Task 1 query (if the category needs evidence) -> drafter -> code guard -> SQLite -> review UI -> simulated send.

- `src/llm.ts`: the only file that calls the LLM (Groq). Retries on 429/5xx.
- `src/knowledge-client/client.ts`: typed client for Task 1. Failure kinds: unreachable, timeout, unauthorized, bad_request, server_error, bad_response.
- `src/email/classifier.ts`: category, urgency, risk, injection flag (prompt classify-v2 plus code rules).
- `src/drafting/drafter.ts`: JSON output validated with zod, up to 3 attempts, article links added by code.
- `src/drafting/guard.ts`: regex safety checks on every draft.
- `src/pipeline.ts`: connects the steps, records timings and notes.
- `src/feedback/db.ts`: SQLite tables, the review counter, duplicate-send protection, the audit log.
- `src/feedback/learning.ts`: prompt versions, regression gate, rollback.
- `src/server.ts` + `public/index.html`: Express API and the review page.

## 3. Evidence modes
- ground (how_to, troubleshooting, follow_up): Task 1 facts may be used in the reply.
- background (refund, quote, project): Task 1 text is context only, nothing may be promised from it.
- none (complaint): Task 1 is not called.

Changelog articles are filtered out, because they could sound like a promise that a problem was fixed.

## 4. Safety layers
1. Email text is treated as untrusted data (tagged in the prompt, shown as plain text in the UI, never run as HTML).
2. Injection suspicion forces risk high and needs_expert.
3. Risk floors in code: project, refund, complaint, quote at least high; follow_up at least medium.
4. Prompt rules 1-16 (no promises, no fault claims, no legal advice, no password requests, plain text).
5. Code guard: price/money, refund promises, "fixed" claims, time frames, vague speed, "logged/noted", fault/secure claims, password/card requests, internal source numbers, links not returned by Task 1.
6. Links are added by code from Task 1 sources only.
7. A draft that fails the guard gets status `guard_failed`. The Approve button is disabled and the server refuses approval.
8. Edited replies are checked by the same guard. A reviewer cannot override it.
9. Human approval is the default for every email.

## 5. Failure states
- Task 1 down and the category needs evidence: status `blocked_kb_unavailable`, no draft, nothing invented (tested with Task 1 stopped; HT-01 blocked, CP-03 still drafted).
- LLM rate limit or error: status `classify_failed` or `draft_failed`. The eval run stops cleanly on the daily token limit and can be resumed.
- Guard failure after 3 attempts: `guard_failed`, shown to the reviewer with the reasons.

## 6. The 20-in-a-row rule
- Unit of counting: category.
- "Unmodified": after trimming, unifying line endings, converting curly quotes to straight quotes, and collapsing whitespace, the final text equals the draft exactly (case-sensitive). Clicking Approve alone is not enough.
- Counts only if: action is approve, text unmodified, guard passed, status draft_ready.
- Resets to 0 on edit, reject, needs_expert, or a guard-failed draft. A reset also switches autonomy off.
- Reaching 20 makes a category eligible. It does not send anything by itself.
- Locked categories that never become autonomous: refund_cancellation, complaint, project_request, quote_request.
- Even in an eligible and enabled category, a draft is auto-sent only if: guard passed, risk not high, no injection, no needs_expert, and (for ground mode) Task 1 answered.
- The switch is per category, configurable in the UI, reversible, and every change is in the audit log.
- Duplicate-send protection: a unique key (hash of email id and normalized final text) in `sent_messages`, plus one review per draft.
- Tested only by a simulation (7/7 cases), not with real review data.

## 7. Data and audit
Tables: emails, drafts (model, classifier and drafter versions, evidence, guard result, attempts, tokens, latency), reviews, sent_messages, category_stats, audit_log, prompt_versions, regression_runs. The audit log stores events and ids, not email text. Limit: email bodies are stored in `emails` for the review UI and are not redacted yet.

## 8. Feedback and improvement
Reviewer reasons for edits and rejects are stored. `recurringCorrections` finds repeated reasons per category. A person writes a candidate prompt version with extra rules. The candidate goes live only after a fixed regression set of 10 dev emails passes all automatic checks and is not worse than the active version. Rollback restores the previous version. Tested by simulation (5/5); the real regression run is still pending.

## 9. Known limits
- Labels and kb_expectation were written by hand; urgency low vs normal is fuzzy.
- The guard is regex-based; it can miss phrasings and cannot detect invented steps.
- Injection patterns were written while looking at RC-06; separate samples are needed.
- Task 1 retrieval varies between runs.
- Groq free tier has a daily token limit; this interrupted evaluation runs.
- Per-email 20b results from the full run were overwritten; the summary numbers were saved from the terminal.
- Sending is simulated.
- The held-out test split (9 emails) has not been run.