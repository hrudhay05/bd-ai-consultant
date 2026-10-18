import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DatasetEmailSchema, type DatasetEmail } from "./types.js";

export function loadDataset(split: "dev" | "test" | "all" = "all"): DatasetEmail[] {
  const dir = path.join(process.cwd(), "data");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^emails_batch\d+\.json$/.test(f))
    .sort();
  const all: DatasetEmail[] = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    all.push(...z.array(DatasetEmailSchema).parse(raw));
  }
  return split === "all" ? all : all.filter((e) => e.split === split);
}