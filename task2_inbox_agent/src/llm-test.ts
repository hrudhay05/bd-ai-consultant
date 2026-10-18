import { callLlm } from "./llm.js";

async function main() {
  const r = await callLlm({
    system: "You are a helpful assistant. Reply with JSON only.",
    user: 'Return a JSON object like {"greeting": "..."} with a short hello.',
    json: true,
  });
  console.log("Provider:", r.provider);
  console.log("Model:", r.model);
  console.log("Latency ms:", r.latencyMs);
  console.log("Tokens in/out:", r.promptTokens, r.completionTokens);
  console.log("Raw text:", r.text);
  console.log("Parsed:", JSON.parse(r.text));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
});