import "dotenv/config";

export interface LlmResult {
  text: string;
  model: string;
  provider: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface LlmOptions {
  system: string;
  user: string;
  model?: string; // overrides LLM_MODEL from .env (used for model comparison)
  json?: boolean; // true = ask for a JSON object back
  maxTokens?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGroq(opts: LlmOptions): Promise<LlmResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing in .env");
  const model = opts.model ?? process.env.LLM_MODEL ?? "openai/gpt-oss-120b";

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: 0.2,
    // gpt-oss models think before answering, so leave room for that
    max_completion_tokens: opts.maxTokens ?? 3000,
  };
  if (opts.json) body.response_format = { type: "json_object" };
  if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

  const started = Date.now();
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (res.ok) {
      const data: any = await res.json();
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        model,
        provider: "groq",
        latencyMs: Date.now() - started,
        promptTokens: data.usage?.prompt_tokens ?? null,
        completionTokens: data.usage?.completion_tokens ?? null,
      };
    }

    lastError = `Groq HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    // retry only on rate limit or server errors
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * attempt);
      continue;
    }
    break;
  }
  throw new Error(lastError);
}

export async function callLlm(opts: LlmOptions): Promise<LlmResult> {
  const provider = process.env.LLM_PROVIDER ?? "groq";
  if (provider === "groq") return callGroq(opts);
  if (provider === "claude") {
    throw new Error("Claude provider is not added yet (no API key). Add it here later.");
  }
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}