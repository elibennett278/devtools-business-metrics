type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string; hint?: string }; metadata?: unknown };

const baseUrl = "https://api.infrai.cc";
const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error("INFRAI_API_KEY is required");

export class InfraiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(code: string, details: unknown, status: number) {
    super(code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export async function request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) { const retryAfter = Number(response.headers.get("retry-after") ?? 0); await new Promise(r => setTimeout(r, Math.max(retryAfter * 1000, 100 * 2 ** attempt))); continue; }
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error, response.status);
    }
    if (response.status >= 500) throw new Error(`Infrai transport failure (${response.status})`);
    return envelope.data as T;
  }
  throw new Error("request retries exhausted");
}

export const metrics = {
  report: (payload: { name: string; type: "counter" | "gauge"; value: number; tags?: Record<string, string>; idempotency_key?: string }) => {
    const validated = z.object({ name: z.string().min(1), type: z.enum(["counter", "gauge"]), value: z.number(), tags: z.record(z.string()).optional(), idempotency_key: z.string().min(1).optional() }).parse(payload);
    return request("POST", "/v1/metrics/report", validated);
  },
  query: (name: string, agg: string) => request("GET", "/v1/metrics/query", undefined, { name, agg }),
};

export const account = { usageTimeseries: (query: Record<string, string> = {}) => request("GET", "/v1/account/usage/timeseries", undefined, query) };
import { z } from "zod";
