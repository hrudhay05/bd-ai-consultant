import "dotenv/config";
import { z } from "zod";

const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  relevance: z.number().nullable().optional(),
  images: z.array(z.any()).nullable().optional(),
});

const KbResponseSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence", "error"]),
  answer: z.string().nullable().optional(),
  sources: z.array(SourceSchema).default([]),
  needs_human: z.boolean().optional(),
  reason: z.string().nullable().optional(),
  escalation_id: z.union([z.number(), z.string()]).nullable().optional(),
  latency_ms: z.number().nullable().optional(),
});

export type KbSource = z.infer<typeof SourceSchema>;
export type KbResponse = z.infer<typeof KbResponseSchema>;

export type KbFailureKind =
  | "unreachable" // server down or network error
  | "timeout"
  | "unauthorized" // wrong API key (401)
  | "bad_request" // 422 or other 4xx
  | "server_error" // 5xx
  | "bad_response"; // JSON did not match our schema

export type KbResult =
  | { ok: true; data: KbResponse }
  | { ok: false; kind: KbFailureKind; message: string };

const KB_URL = () => process.env.KB_URL ?? "http://127.0.0.1:8000";
const KB_KEY = () => process.env.KB_API_KEY ?? "";

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<KbResult | Response> {
  try {
    return await fetch(`${KB_URL()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": KB_KEY(),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, kind: "timeout", message: `Knowledge service timed out after ${timeoutMs} ms` };
    }
    return { ok: false, kind: "unreachable", message: `Cannot reach knowledge service at ${KB_URL()}` };
  }
}

export async function queryKnowledge(question: string): Promise<KbResult> {
  const out = await request(
    "/query",
    { method: "POST", body: JSON.stringify({ question }) },
    30_000
  );
  if (!(out instanceof Response)) return out;

  if (out.status === 401) {
    return { ok: false, kind: "unauthorized", message: "Knowledge service rejected the API key (401)" };
  }
  if (out.status >= 500) {
    return { ok: false, kind: "server_error", message: `Knowledge service error (HTTP ${out.status})` };
  }
  if (!out.ok) {
    const body = (await out.text()).slice(0, 300);
    return { ok: false, kind: "bad_request", message: `Knowledge service rejected the request (HTTP ${out.status}): ${body}` };
  }

  let json: unknown;
  try {
    json = await out.json();
  } catch {
    return { ok: false, kind: "bad_response", message: "Knowledge service returned invalid JSON" };
  }
  const parsed = KbResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, kind: "bad_response", message: `Unexpected response shape: ${parsed.error.message.slice(0, 300)}` };
  }
  return { ok: true, data: parsed.data };
}

export async function kbHealth(): Promise<boolean> {
  const out = await request("/health", { method: "GET" }, 5_000);
  return out instanceof Response && out.ok;
}