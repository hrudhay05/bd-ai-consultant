import fs from "node:fs";

async function main() {
  process.env.DB_FILE = "data/test-sim.db";
  for (const f of ["data/test-sim.db", "data/test-sim.db-wal", "data/test-sim.db-shm"]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  const { saveDraft, recordReview, eligibility, setAutonomy, mayAutoSend } = await import("../src/feedback/db.js");

  const mk = (cat: string, i: number) =>
    saveDraft({
      email_id: `SIM-${cat}-${i}`,
      status: "draft_ready",
      category: cat,
      risk: "low",
      evidence_mode: "ground",
      kb_status: "answered",
      reply_body: `Hello ${i}, here are the steps.`,
      guard_passed: true,
    });

  let ok = 0;
  let bad = 0;
  const check = (name: string, cond: boolean) => {
    console.log(cond ? "PASS" : "FAIL", name);
    if (cond) ok++;
    else bad++;
  };

  for (let i = 1; i <= 19; i++) recordReview(mk("how_to", i), "approve", null, null);
  check("19 approvals -> not eligible", !eligibility("how_to").eligible);
  recordReview(mk("how_to", 20), "approve", null, null);
  check("20 approvals -> eligible", eligibility("how_to").eligible && eligibility("how_to").streak === 20);
  recordReview(mk("how_to", 21), "edit", "Hello 21, here are the steps!!", "tone");
  check("edit resets streak to 0", eligibility("how_to").streak === 0);

  for (let i = 30; i < 50; i++) recordReview(mk("how_to", i), "approve", null, null);
  setAutonomy("how_to", true);
  check("auto-send allowed for low-risk draft", mayAutoSend(mk("how_to", 99)).ok);
  recordReview(mk("how_to", 100), "reject", null, "wrong");
  check(
    "reject resets and switches autonomy off",
    !eligibility("how_to").autonomy_enabled && eligibility("how_to").streak === 0
  );

  for (let i = 1; i <= 20; i++) recordReview(mk("refund_cancellation", i), "approve", null, null);
  check("refund locked even at 20", !eligibility("refund_cancellation").eligible);

  const id = mk("follow_up", 1);
  recordReview(id, "approve", null, null);
  let blocked = false;
  try {
    recordReview(id, "approve", null, null);
  } catch {
    blocked = true;
  }
  check("second review of same draft blocked", blocked);

  console.log(`\n${ok} passed, ${bad} failed (simulation, not real review data)`);
}

main();