import "dotenv/config";
import fs from "node:fs";
import { loadDataset } from "../email/dataset.js";
import { processEmail } from "../pipeline.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOCK = "data/evals/TEST_RUN_DONE.lock";

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.log("This runs the held-out test split ONCE. Finish all tuning first. Run again with --confirm.");
    return;
  }
  if (fs.existsSync(LOCK)) {
    console.log("The held-out test was already run completely. Not running again.");
    return;
  }
  const model = process.env.LLM_MODEL ?? "openai/gpt-oss-120b";
  const test = loadDataset("test");
  console.log(`Held-out emails: ${test.length}`);
  const results: any[] = [];
  let stopped = false;

  for (const e of test) {
    process.stdout.write(`${e.id} ... `);
    const out: any = await processEmail(e, model);
    const guardFailed = !!(out.draft && out.guard && !out.guard.passed);
    const status = guardFailed ? "guard_failed" : out.status;
    results.push({
      id: e.id,
      subject: e.subject,
      expected_category: (e as any).expected_category,
      expected_urgency: (e as any).expected_urgency,
      expected_risk: (e as any).expected_risk,
      category: out.classification?.category,
      urgency: out.classification?.urgency,
      risk: out.classification?.risk,
      injection: out.classification?.injection_suspected,
      status,
      guard_passed: out.guard?.passed ?? null,
      violations: out.guard?.violations ?? [],
      attempts: out.draft_meta?.attempts ?? null,
      total_ms: out.total_latency_ms,
      reply_body: out.draft?.reply_body ?? null,
      reply_must: (e as any).reply_must,
      reply_must_not: (e as any).reply_must_not,
      notes: out.notes,
    });
    console.log(status, out.total_latency_ms, "ms");
    if (/tokens per day|\(TPD\)/i.test((out.notes ?? []).join(" "))) {
      console.log("Daily token limit reached. Stopping.");
      stopped = true;
      break;
    }
    await sleep(1500);
  }

  const done = ["draft_ready", "guard_failed", "blocked_kb_unavailable"];
  const completed = results.filter((r) => done.includes(r.status));
  const summary = {
    model,
    prompt: "draft-v3 / classify-v2",
    test_emails: test.length,
    completed: completed.length,
    category_correct: completed.filter((r) => r.category === r.expected_category).length,
    urgency_correct: completed.filter((r) => r.urgency === r.expected_urgency).length,
    risk_correct: completed.filter((r) => r.risk === r.expected_risk).length,
    guard_passed: completed.filter((r) => r.guard_passed).length,
  };
  fs.mkdirSync("data/evals", { recursive: true });
  fs.writeFileSync("data/evals/heldout_test.json", JSON.stringify({ summary, results }, null, 2), "utf8");
  console.log("\nSUMMARY", JSON.stringify(summary, null, 2));

  if (stopped || completed.length < test.length) {
    console.log("INCOMPLETE. Not locked. Fix the cause and run again.");
  } else {
    fs.writeFileSync(LOCK, new Date().toISOString());
    console.log("Complete. Locked. Do not tune on these results.");
  }
}
main();