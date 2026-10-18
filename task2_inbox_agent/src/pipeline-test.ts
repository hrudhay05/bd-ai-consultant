import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadDataset } from "./email/dataset.js";
import { processEmail } from "./pipeline.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const lines: string[] = [];
function log(...parts: unknown[]) {
  const text = parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ");
  console.log(text);
  lines.push(text);
}

async function main() {
  const ids = arg("ids", "HT-01,TS-01,HT-12,RC-01,CP-03,QT-01,FU-03").split(",");
  const model = arg("model", process.env.LLM_MODEL ?? "openai/gpt-oss-120b");
  const outFile = arg("out", "data/evals/pipeline_run4.txt");
  const dev = loadDataset("dev"); // test split is never used here

  let done = 0;
  let drafted = 0;
  let guardPassed = 0;
  let totalAttempts = 0;

  for (const id of ids) {
    const e = dev.find((x) => x.id === id);
    if (!e) {
      log(`\n${id}: not in the dev split, skipped`);
      continue;
    }
    const out = await processEmail(e, model);
    done++;
    log("\n==================================================");
    log(`${e.id} | ${e.subject}`);
    log("Status:", out.status, "| total ms:", out.total_latency_ms);

    const timing = (out as unknown as { timing?: Record<string, number> }).timing;
    log("Timing ms:", timing ?? "(no timing object in pipeline output)");

    if (out.classification) {
      const c = out.classification;
      log(`Class: ${c.category} | ${c.urgency} | risk ${c.risk} | injection ${c.injection_suspected}`);
    }
    log("Evidence mode:", out.evidence_mode, "| KB called:", out.kb.called, "| KB status:", out.kb.status ?? out.kb.failure ?? "-");
    log("KB sources:", out.kb.sources.map((s) => `${s.title} (${s.relevance})`));

    if (out.draft) {
      drafted++;
      log("\nSUBJECT:", out.draft.reply_subject);
      log(out.draft.reply_body);
      log("\nNext action:", out.draft.next_action, "| follow-up days:", out.draft.follow_up_days, "| needs expert:", out.draft.needs_expert);
      log("Guard passed:", out.guard?.passed, out.guard?.violations ?? []);
      log("Draft attempts:", out.draft_meta?.attempts, "| draft ms:", out.draft_meta?.latencyMs, "| tokens in/out:", out.draft_meta?.promptTokens, out.draft_meta?.completionTokens);
      if (out.guard?.passed) guardPassed++;
      totalAttempts += out.draft_meta?.attempts ?? 0;
    }
    log("Notes:", out.notes);
  }

  log("\n==================================================");
  log("SUMMARY");
  log(`Emails processed: ${done} | drafted: ${drafted} | guard passed: ${guardPassed}/${drafted} | total draft attempts: ${totalAttempts}`);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n"), "utf8");
  console.log(`\nSaved to ${outFile}`);
}

main();