# Business Labs Capstone: AI Tech Consultant (Brilliant Directories)

Three connected projects. All customer emails and meetings are fictional or role-played. Email sending is simulated. No API keys are stored in this repository.

| Folder | Project | Stack | Status |
|---|---|---|---|
| `task1_knowledge_brain` | Knowledge Brain | Python, FastAPI | Done earlier |
| `task2_inbox_agent` | Inbox Agent | TypeScript, Node, Express, SQLite | Built and tested; some evaluation runs pending |
| `task3_meeting_to_scope` | Meeting to Scope | Python, Pydantic, SQLite | In progress |

## How they connect
Task 2 and Task 3 both call the Task 1 API (`POST /query` with header `X-API-Key`) for product evidence. If Task 1 is down, they report a clear failure state and invent nothing.

## Requirements
- Windows or any OS with Python 3.10+, Node.js 24, npm 11
- A free Groq API key (shared by all three tasks; the free tier has a daily token limit)

## Run order
1. Start Task 1 (own window): `cd task1_knowledge_brain`, activate `.venv`, then `python -m uvicorn app.api:app --port 8000`.
2. Start Task 2 or Task 3 as described below.

Each task needs its own `.env` (copy `.env.example` and fill in the keys).

---

## Task 1 - Knowledge Brain
Answers product questions from Brilliant Directories support articles.
- `POST /query` with `{"question": "..."}` (at least 3 characters) and header `X-API-Key`.
- Returns `status` (`answered`, `insufficient_evidence`, `error`), `answer`, `sources` (title, url, relevance, images), `needs_human`, `reason`, `escalation_id`, `latency_ms`.
- Checked from Task 2: "How do refunds work?" gave an answer with a source; nonsense gave `insufficient_evidence`; a too-short question gave HTTP 422.
- Known limits: retrieval is not stable between runs; changelog articles can appear as evidence; 3 known failing eval questions and 25 failed page crawls were not investigated; some Task 1 to-dos (pytest, scheduled refresh, frontend) are unconfirmed.

## Task 2 - Inbox Agent
Reads a customer email, classifies category/urgency/risk and injection, asks Task 1 for evidence, writes a safe draft, and lets a human review it.

Run:
```
cd task2_inbox_agent
npm install
npx tsx src\server.ts
```
Open http://localhost:3000.

Main parts: classifier (classify-v2), evidence modes (ground, background, none), drafter with JSON validation and up to 3 attempts, regex safety guard (also applied to edited replies), SQLite (drafts, reviews, simulated sends with a duplicate-send key, audit log), the 20-unmodified-in-a-row rule per category with locked categories (refund, complaint, project, quote), prompt versions with a regression gate and rollback.

Results on the dev split (real runs): classifier category 39/41, urgency 26/41, risk 36/41; drafts completed 41/41 with gpt-oss-20b (guard passed 37, first try 24, 11.7 s average) and 36/41 with gpt-oss-120b (guard passed 35, first try 7). "Guard passed" is not a quality score.

Pending: held-out test (9 emails, stopped by the Groq daily limit), regression baseline, manual quality scoring. Counter and learning tests are simulations. Details: `task2_inbox_agent/README.md`, `DESIGN.md`, `EVALS.md`, `AI_LOG.md`.

## Task 3 - Meeting to Scope
Turns role-played client meetings into requirements, scope of work, hour estimates and a proposal, compares a follow-up meeting against the approved baseline, and requires human approval before anything is "sent".

Done and tested:
- Three role-played transcripts: A (2026-10-12), B (2026-10-14), C (follow-up to A).
- Staged chunking (20 turns per chunk, 5 overlap).
- Pydantic models, SQLite storage and the send gate (a draft or unapproved revision cannot be sent; the baseline stays on the approved version).
- Task 1 client, Groq client with retries, daily-limit stop and cache.
- Code check that every quote the model returns really appears in the transcript.
- Transcript Analyst measured on Meeting A only (gpt-oss-20b, 13 requirements; known issues remain).

Not done yet: extraction for B and C, feasibility check through Task 1, scope, estimation and proposal agents, follow-up comparison, full review UI, 20 evaluation cases, model comparison, Task 3 documents.

## Honest limits
- Hand-written labels and role-played transcripts.
- Regex and quote checks cannot detect every invented statement.
- Retrieval from Task 1 varies between runs.
- All three tasks share the Groq free-tier daily token limit, which interrupted several runs.
