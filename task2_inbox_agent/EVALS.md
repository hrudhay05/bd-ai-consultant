# EVALS.md - Task 2 Inbox Agent

All numbers are from real runs on the dev split (41 emails). The held-out test split (9 emails) has NOT been run yet.

## 1. Dataset
50 hand-written emails, 7 categories. 41 dev, 9 held-out test. Each has expected category, urgency, risk, reply_must and reply_must_not. Labels were written by hand; urgency low vs normal is fuzzy.

## 2. Eval cases (at least 20)
The 41 dev emails are the eval cases. A fixed regression set of 10 dev emails (HT-01, TS-01, HT-12, RC-01, RC-02, CP-03, CP-04, QT-01, FU-03, TS-06) is used to gate new prompt versions.

## 3. Classifier (gpt-oss-120b, 41 dev emails, 0 failures)
| Version | Category | Urgency | Risk (final) | Avg latency |
|---|---|---|---|---|
| classify-v1 | 38/41 | 27/41 | 32/41 | 1361 ms |
| classify-v2 | 39/41 | 26/41 | 36/41 | 1475 ms |
v2 kept. v2 definitions were written after reading dev mistakes, so part of the gain is fitted to dev. Urgency misses are almost all one level off.

## 4. Drafting: model comparison (draft-v3, classify-v2)
Same 36 emails completed by both models:
| Model | Guard passed | First-try pass | Avg time | Tokens in / out |
|---|---|---|---|---|
| gpt-oss-120b | 35/36 | 7/36 | 18.5 s | 45,052 / 9,988 |
| gpt-oss-20b | 32/36 | 19/36 | 12.0 s | 50,429 / 10,548 |
Cost: $0 (Groq free tier); token counts are for the final attempt only.
All 41 emails with 20b: 41 completed, 37 guard passed, 24 first-try, avg 11.7 s, max 27 s.
120b on 41: 36 completed. The Groq daily token limit (200,000 per day) stopped the rest (QT-04, FU-01 to FU-04).

Caveats:
- 120b times include rate-limit waits (e.g. 104 s for PR-02, 704 s for CP-04 with a network error), so speed is NOT a fair comparison.
- "Guard passed" means no regex rule fired. It is not a quality score.
- 27 of 36 120b emails needed 2 attempts; the reason is unknown because per-attempt logging was added after that run.
- 20b guard failures: RC-02, RC-03, RC-05 (vague speed words), TS-06 (empty used_source_urls).

## 5. Quality vs reply_must / reply_must_not
PENDING: drafts have not been scored by hand yet. Only CP-03 (120b) was read: no fault, compensation or legal advice; "acknowledge seriousness" was weak.

## 6. Safety checks
- tests/guard-test.ts: 17/17 (sentences written together with the patterns, so a basic check only).
- Task 1 down: HT-01 gave blocked_kb_unavailable, CP-03 still drafted (real test).
- Simulation tests (not real review data): counter 7/7, learning module 5/5.
- Injection detection: not fairly tested (patterns written while looking at RC-06; separate samples needed).

## 7. Regression and improvement
PENDING: baseline regression run of draft-v3 and a draft-v4 candidate. The gate logic works in simulation only.

## 8. Held-out test
PENDING: run once at the end, no tuning afterward.

## 9. Limits
Hand labels; regex guard cannot detect invented steps (HT-01 steps not verified against the article text); Task 1 retrieval varies between runs; per-email 20b drafts from the full run were overwritten (summary numbers kept); Groq daily limit interrupted runs.