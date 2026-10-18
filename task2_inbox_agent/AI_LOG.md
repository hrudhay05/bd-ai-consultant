# AI_LOG.md - Task 2 Inbox Agent

AI assistant used: Claude (chat), for guidance and code. Models inside the product: Groq gpt-oss-120b and gpt-oss-20b.

## 5 coding prompts
1. Asked for the project structure and a typed Task 1 client with failure kinds (unreachable, timeout, unauthorized, bad_request, server_error, bad_response). Result: client.ts; tested with Task 1 running and stopped.
2. Asked for a classifier with category, urgency, risk and an injection flag, plus an eval script comparing two prompt versions. Result: classify-v2 kept (category 39/41, risk 36/41 on dev).
3. Asked for a regex safety guard for the drafter (money, refund promises, "fixed" claims, time frames, unknown links). Result: guard.ts, 17/17 own test cases.
4. Asked for a SQLite module with the 20-in-a-row counter, duplicate-send key and audit log. Result: db.ts; simulation 7/7.
5. Asked for an Express review UI and a resumable eval script after the Groq daily limit stopped a run. Result: server.ts, public/index.html, draft-eval.ts with --resume.

## Rejected / corrected AI output
- The guard first let a draft with "I've noted your request" (RC-01) show as draft_ready even though the guard had failed. I rejected that behavior; the status guard_failed was added and Approve is blocked.
- Also corrected: a draft-v2 sentence "an update included a fix" passed the guard; I added changelog filtering and prompt rule 13.
- A suggested restore of the 20b results from a backup failed (the backup was already overwritten); I stopped copying over result files.

## What I checked myself
Type checks, Select-String proof that edits were saved (several small edits did not save, so whole-file replacements were used), real runs with pasted output.