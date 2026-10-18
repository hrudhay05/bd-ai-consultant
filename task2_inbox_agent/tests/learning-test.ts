import fs from "node:fs";

async function main() {
  process.env.DB_FILE = "data/test-learn.db";
  for (const f of ["data/test-learn.db", "data/test-learn.db-wal", "data/test-learn.db-shm"]) if (fs.existsSync(f)) fs.rmSync(f);
  const { saveDraft, recordReview } = await import("../src/feedback/db.js");
  const L = await import("../src/feedback/learning.js");

  let ok = 0, bad = 0;
  const check = (n: string, c: boolean) => { console.log(c ? "PASS" : "FAIL", n); c ? ok++ : bad++; };
  const mk = (i: number) => saveDraft({ email_id: `SIM-${i}`, status: "draft_ready", category: "how_to", risk: "low", reply_body: `Hi ${i}.`, guard_passed: true });

  for (let i = 1; i <= 3; i++) recordReview(mk(i), "edit", `Hi ${i}, please see steps.`, "Too vague");
  recordReview(mk(4), "edit", "Hi 4, changed.", "other");
  const rc: any[] = L.recurringCorrections(2) as any[];
  check("recurring reason found (3 times)", rc.length === 1 && rc[0].times === 3);

  L.addCandidate("draft-v4", "Always ask for the exact error text.", "from recurring 'too vague'");
  let blocked = false;
  try { L.activate("draft-v4"); } catch { blocked = true; }
  check("activation blocked without regression run", blocked);

  L.recordRegression("draft-v4", 9, 10, {});
  blocked = false;
  try { L.activate("draft-v4"); } catch { blocked = true; }
  check("activation blocked at 9/10", blocked);

  L.recordRegression("draft-v4", 10, 10, {});
  L.activate("draft-v4");
  check("v4 active after 10/10", L.activeVersion().version === "draft-v4");

  L.rollback("simulated quality drop");
  check("rollback returns to draft-v3", L.activeVersion().version === "draft-v3");

  console.log(`\n${ok} passed, ${bad} failed (simulation, not real review data)`);
}
main();