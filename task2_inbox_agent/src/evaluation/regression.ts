import "dotenv/config";
import fs from "node:fs";
import { loadDataset } from "../email/dataset.js";
import { processEmail } from "../pipeline.js";
import { setPromptVersion } from "../drafting/drafter.js";
import { db } from "../feedback/db.js";
import { activeVersion, recordRegression } from "../feedback/learning.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const version = arg("version", activeVersion().version);
  const model = arg("model", process.env.LLM_MODEL ?? "openai/gpt-oss-120b");
  const row = db.prepare("SELECT * FROM prompt_versions WHERE version=?").get(version) as any;
  if (!row) throw new Error(`unknown prompt version: ${version}`);
  setPromptVersion(row.version, row.extra_rules);

  const set = JSON.parse(fs.readFileSync("data/regression_set.json", "utf8"));
  const dev = loadDataset("dev"); // held-out test split is never used here
  const details: any[] = [];
  let passed = 0;
  let incomplete = 0;
  const review: string[] = [];

  for (const id of set.ids as string[]) {
    const e = dev.find((x) => x.id === id);
    if (!e) {
      details.push({ id, result: "missing" });
      incomplete++;
      continue;
    }
    process.stdout.write(`${id} ... `);
    const out: any = await processEmail(e, model);
    if (!out.draft && out.status !== "blocked_kb_unavailable") {
      incomplete++;
      details.push({ id, result: "incomplete", status: out.status, notes: out.notes });
      console.log("incomplete", out.status);
      const text = (out.notes ?? []).join(" ");
      if (/tokens per day|\(TPD\)/i.test(text)) {
        console.log("Daily token limit reached. Stopping. Nothing is recorded.");
        break;
      }
      await sleep(1500);
      continue;
    }
    const body: string = out.draft?.reply_body ?? "";
    const pattern: string | undefined = set.required?.[id];
    const reqOk = !pattern || new RegExp(pattern, "i").test(body);
    const guardOk = !!out.guard?.passed;
    const ok = !!out.draft && guardOk && reqOk;
    if (ok) passed++;
    details.push({ id, result: ok ? "pass" : "fail", guard: guardOk, required_phrase_ok: reqOk, attempts: out.draft_meta?.attempts, violations: out.guard?.violations ?? [] });
    console.log(ok ? "pass" : "FAIL", guardOk ? "" : JSON.stringify(out.guard?.violations));
    review.push(`=== ${id}\nREPLY:\n${body || "(no draft)"}\nMUST NOT: ${JSON.stringify((e as any).reply_must_not)}\nHUMAN CHECK: violated? __\n`);
    await sleep(1500);
  }

  fs.mkdirSync("data/evals", { recursive: true });
  fs.writeFileSync(`data/evals/regression_${version}.txt`, review.join("\n"), "utf8");
  fs.writeFileSync(`data/evals/regression_${version}.json`, JSON.stringify({ version, model, passed, total: set.ids.length, incomplete, details }, null, 2), "utf8");

  if (incomplete > 0) {
    console.log(`\nINCOMPLETE (${incomplete} cases did not finish). Result NOT recorded: ${passed}/${set.ids.length} passed so far.`);
    return;
  }
  recordRegression(version, passed, set.ids.length, details);
  console.log(`\nREGRESSION ${version}: ${passed}/${set.ids.length} passed (recorded). Now read data\\evals\\regression_${version}.txt for reply_must_not.`);
}

main();