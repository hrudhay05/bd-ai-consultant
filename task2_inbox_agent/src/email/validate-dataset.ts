import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DatasetEmailSchema } from "./types.js";

const dir = path.join(process.cwd(), "data");
const files = fs.readdirSync(dir).filter((f) => /^emails_batch\d+\.json$/.test(f)).sort();

const all: z.infer<typeof DatasetEmailSchema>[] = [];
let problems = 0;

for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const parsed = z.array(DatasetEmailSchema).safeParse(raw);
  if (!parsed.success) {
    problems++;
    console.log(`INVALID FILE ${f}:`, parsed.error.message.slice(0, 500));
    continue;
  }
  console.log(`${f}: ${parsed.data.length} emails OK`);
  all.push(...parsed.data);
}

const ids = new Set<string>();
for (const e of all) {
  if (ids.has(e.id)) {
    problems++;
    console.log("DUPLICATE ID:", e.id);
  }
  ids.add(e.id);
}

const byCategory: Record<string, number> = {};
const bySplit: Record<string, number> = {};
for (const e of all) {
  byCategory[e.expected_category] = (byCategory[e.expected_category] ?? 0) + 1;
  bySplit[e.split] = (bySplit[e.split] ?? 0) + 1;
}

console.log("\nTotal emails:", all.length);
console.log("By category:", byCategory);
console.log("By split:", bySplit);
console.log(problems === 0 ? "\nDataset is valid." : `\n${problems} problem(s) found.`);