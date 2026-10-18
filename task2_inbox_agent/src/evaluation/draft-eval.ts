import "dotenv/config";
import fs from "node:fs";
import { loadDataset } from "../email/dataset.js";
import { processEmail } from "../pipeline.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DONE = ["draft_ready", "guard_failed", "blocked_kb_unavailable"];

function save(results: any[], model: string, tag: string, total: number) {
  const completed = results.filter((r) => DONE.includes(r.status));
  const drafted = completed.filter((r) => r.reply_body);
  const sum = (f: (r: any) => number) => completed.reduce((a, r) => a + (f(r) || 0), 0);
  const summary = {
    model,
    prompt: "draft-v3 / classify-v2",
    dev_emails: total,
    completed: completed.length,
    not_completed: total - completed.length,
    drafted: drafted.length,
    guard_passed: drafted.filter((r) => r.guard_passed).length,
    first_try_pass: drafted.filter((r) => r.guard_passed && r.attempts === 1).length,
    blocked_kb: completed.filter((r) => r.status === "blocked_kb_unavailable").length,
    avg_total_ms: Math.round(sum((r) => r.total_ms) / Math.max(1, completed.length)),
    max_total_ms: Math.max(0, ...completed.map((r) => r.total_ms || 0)),
    tokens_in: sum((r) => r.tokens_in),
    tokens_out: sum((r) => r.tokens_out),
    cost_usd: 0,
    note: "stats cover completed emails only; tokens are for the final draft attempt; cost is 0 on the Groq free tier",
  };
  fs.mkdirSync("data/evals", { recursive: true });
  fs.writeFileSync(`data/evals/draft-v3_${tag}_dev.json`, JSON.stringify({ summary, results }, null, 2), "utf8");
  const txt = results
    .map(
      (r) =>
        `=== ${r.id} | ${r.subject ?? ""}\nstatus: ${r.status} | guard: ${r.guard_passed} ${JSON.stringify(r.violations ?? [])} | attempts: ${r.attempts} | ms: ${r.total_ms}\n\nREPLY:\n${r.reply_body ?? "(no draft)"}\n\nMUST: ${JSON.stringify(r.reply_must)}\nMUST NOT: ${JSON.stringify(r.reply_must_not)}\nSCORE (you fill): must met __/__ | must_not violated __\n`
    )
    .join("\n");
  fs.writeFileSync(`data/evals/draft-v3_${tag}_dev_review.txt`, txt, "utf8");
  return summary;
}

async function main() {
  const model = arg("model", process.env.LLM_MODEL ?? "openai/gpt-oss-120b");
  const limit = Number(arg("limit", "999"));
  const pauseMs = Number(arg("pause", "1500"));
  const dev = loadDataset("dev").slice(0, limit); // held-out test split is never used here
  const tag = model.replace(/[^a-z0-9]+/gi, "_");
  const jsonFile = `data/evals/draft-v3_${tag}_dev.json`;

  const previous: Record<string, any> = {};
  if (process.argv.includes("--resume") && fs.existsSync(jsonFile)) {
    const old = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    for (const r of old.results ?? []) if (DONE.includes(r.status)) previous[r.id] = r;
    console.log(`Resume: keeping ${Object.keys(previous).length} finished results, rerunning the rest.`);
  }

  const results: any[] = [];
  let stopped = false;
  for (const e of dev) {
    if (previous[e.id]) {
      results.push(previous[e.id]);
      continue;
    }
    if (stopped) {
      results.push({ id: e.id, subject: e.subject, status: "not_run" });
      continue;
    }
    process.stdout.write(`${e.id} ... `);
    let rec: any;
    try {
      const out: any = await processEmail(e, model);
      const guardFailed = !!(out.draft && out.guard && !out.guard.passed);
      rec = {
        id: e.id,
        subject: e.subject,
        expected_category: (e as any).expected_category,
        category: out.classification?.category,
        status: guardFailed ? "guard_failed" : out.status,
        guard_passed: out.guard?.passed ?? null,
        violations: out.guard?.violations ?? [],
        attempts: out.draft_meta?.attempts ?? null,
        attempt_log: out.draft_meta?.attemptLog ?? null,
        total_ms: out.total_latency_ms,
        timing: out.timing ?? null,
        tokens_in: out.draft_meta?.promptTokens ?? null,
        tokens_out: out.draft_meta?.completionTokens ?? null,
        kb_status: out.kb?.status ?? out.kb?.failure ?? null,
        reply_body: out.draft?.reply_body ?? null,
        reply_must: (e as any).reply_must,
        reply_must_not: (e as any).reply_must_not,
        notes: out.notes,
      };
    } catch (err: any) {
      rec = { id: e.id, subject: e.subject, status: "error", notes: [String(err?.message ?? err)] };
    }
    results.push(rec);
    console.log(rec.status, `${rec.total_ms ?? ""} ms`);
    save(results.concat(dev.slice(results.length).map((x) => ({ id: x.id, subject: x.subject, status: "not_run" }))), model, tag, dev.length);

    const text = (rec.notes ?? []).join(" ");
    if (/tokens per day|\(TPD\)/i.test(text)) {
      console.log("\nDaily token limit reached. Stopping. Run again later with --resume.");
      stopped = true;
    }
    await sleep(pauseMs);
  }

  const summary = save(results, model, tag, dev.length);
  console.log("\nSUMMARY", JSON.stringify(summary, null, 2));
  console.log(`Saved ${jsonFile} and _review.txt`);
}

main();