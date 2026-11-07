// Shared by generate.ts and bench.ts: send generated traces to a running explorer over OTLP/HTTP.
import { config } from "../src/server/config";
import { toOtlp, type SimSpan } from "../src/sim/agent";

export const BASE = process.env.EXPLORER_URL ?? "http://127.0.0.1:3000";

export function authHeader(): string {
  const p = config().projects[0];
  return "Basic " + Buffer.from(`${p.public_key}:${p.secret_key}`).toString("base64");
}

/** Posts spans in OTLP batches, `parallel` requests at a time. Returns wall time spent sending, in ms. */
export let retries = 0;

export async function send(spans: SimSpan[], batch = 2000, parallel = 4): Promise<number> {
  const bodies = toOtlp(spans, batch).map((b) => JSON.stringify(b));
  const auth = authHeader();
  let next = 0;
  const t0 = performance.now();
  const worker = async () => {
    while (next < bodies.length) {
      const i = next++;
      // Like an OTLP exporter: retry a dropped connection or a 5xx with backoff, never a 4xx.
      for (let attempt = 0; ; attempt++) {
        let status = 0;
        let detail = "";
        try {
          const r = await fetch(`${BASE}/api/public/otel/v1/traces`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: bodies[i] });
          if (r.ok) { await r.arrayBuffer(); break; }
          status = r.status;
          detail = await r.text();
        } catch (e) {
          detail = String((e as Error).cause ?? e);
        }
        if (attempt >= 4 || (status >= 400 && status < 500)) throw new Error(`ingest batch ${i}: ${status || "network"} ${detail}`);
        retries++;
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return performance.now() - t0;
}

export async function timed(path: string): Promise<{ ms: number; bytes: number; body: string; status: number }> {
  const t0 = performance.now();
  const r = await fetch(`${BASE}${path}`);
  const body = await r.text();
  return { ms: performance.now() - t0, bytes: Buffer.byteLength(body), body, status: r.status };
}

export function pct(xs: number[]): { p50: number; p95: number } {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { p50: Math.round(q(0.5) * 10) / 10, p95: Math.round(q(0.95) * 10) / 10 };
}
