import { queryKnowledge, kbHealth } from "./knowledge-client/client.js";

async function main() {
  console.log("Health:", await kbHealth());

  const questions = [
    "How do refunds work?",
    "What is the airspeed velocity of an unladen swallow?",
    "hi",
  ];
  for (const q of questions) {
    console.log("\n=== Question:", q);
    const r = await queryKnowledge(q);
    if (!r.ok) {
      console.log("FAILURE:", r.kind, "-", r.message);
      continue;
    }
    console.log("status:", r.data.status);
    console.log("needs_human:", r.data.needs_human);
    console.log("reason:", r.data.reason);
    console.log("answer:", (r.data.answer ?? "").slice(0, 200));
    console.log("sources:", r.data.sources.map((s) => `${s.title} (${s.relevance})`));
  }
}

main();