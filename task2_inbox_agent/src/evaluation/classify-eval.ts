import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadDataset } from "../email/dataset.js";
import { classifyEmail, CLASSIFIER_PROMPT_VERSION } from "../email/classifier.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const split = arg("split", "dev") as "dev" | "test" | "all";
  const limit = Number(arg("limit", "9999"));
  const model = arg("model", process.env.LLM_MODEL ?? "openai/gpt-oss-120b");

  const emails = loadDataset(split).slice(0, limit);
  console.log(`Classifying ${emails.length} emails (split=${split}) with ${model}\n`);

  const rows: any[] = [];
  let catOk = 0, urgOk = 0, riskOk = 0, modelRiskOk = 0, failed = 0;
  let injExpected = 0, injCaught = 0, falseInj = 0;
  let totalLatency = 0, totalIn = 0, totalOut = 0;

  for (const e of emails) {
    const r = await classifyEmail(e, model);
    if (!r.ok) {
      failed++;
      console.log(`${e.id}: FAILED - ${r.error}`);
      rows.push({ id: e.id, error: r.error });
      await sleep(500);
      continue;
    }
    const c = r.result;
    const cOk = c.category === e.expected_category;
    const uOk = c.urgency === e.expected_urgency;
    const rOk = c.risk === e.expected_risk;
    if (cOk) catOk++;
    if (uOk) urgOk++;
    if (rOk) riskOk++;
    if (c.model_risk === e.expected_risk) modelRiskOk++;
    const isInj = e.tags.includes("prompt_injection");
    if (isInj) { injExpected++; if (c.injection_suspected) injCaught++; }
    else if (c.injection_suspected) falseInj++;

    totalLatency += r.meta.latencyMs;
    totalIn += r.meta.promptTokens;
    totalOut += r.meta.completionTokens;

    const flags = [!cOk && "CATEGORY", !uOk && "URGENCY", !rOk && "RISK"].filter(Boolean).join(",");
    console.log(
      `${e.id}: cat ${c.category}${cOk ? "" : ` (expected ${e.expected_category})`} | urg ${c.urgency}${uOk ? "" : ` (expected ${e.expected_urgency})`} | risk ${c.risk}${rOk ? "" : ` (expected ${e.expected_risk})`} | inj ${c.injection_suspected}${flags ? "  <-- " + flags : ""}`
    );
    rows.push({ id: e.id, expected: { category: e.expected_category, urgency: e.expected_urgency, risk: e.expected_risk }, got: c, meta: r.meta });
    await sleep(500);
  }

  const done = emails.length - failed;
  const summary = {
    model,
    prompt_version: CLASSIFIER_PROMPT_VERSION,
    split,
    emails: emails.length,
    failed,
    category_correct: catOk,
    urgency_correct: urgOk,
    risk_correct_final: riskOk,
    risk_correct_model_only: modelRiskOk,
    injection_expected: injExpected,
    injection_caught: injCaught,
    false_injection_flags: falseInj,
    avg_latency_ms: done ? Math.round(totalLatency / done) : null,
    total_prompt_tokens: totalIn,
    total_completion_tokens: totalOut,
  };
  console.log("\nSUMMARY", summary);

  const outDir = path.join(process.cwd(), "data", "evals");
  fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${CLASSIFIER_PROMPT_VERSION}_${model.replace(/[\/:]/g, "_")}_${split}.json`);
  fs.writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
  console.log("Saved:", file);
}

main();