// Synthetic traces of long-running agents, emitted as OpenTelemetry spans the way an SDK exports
// them: in batches, each span when it ends (so children arrive before their parents), with
// Langfuse and GenAI semantic-convention attributes. Nothing here is real user data.

export interface Shape {
  name: string;
  /** Probability that a step spawns a sub-agent, and how deep sub-agents may nest. */
  subAgentRate: number;
  maxDepth: number;
  /** Tool calls per planning step: min..max. */
  toolsPerStep: [number, number];
  /** Share of tool calls that fail (and are retried). */
  errorRate: number;
  /** Occasionally a step fans out into many parallel calls (a map over items). */
  fanOutRate: number;
  fanOutSize: [number, number];
  /** Idle gaps between steps in seconds (human-in-the-loop waits, rate-limit backoff). */
  idleGap: [number, number];
  /** Share of spans whose parent is never exported (a crashed worker, a dropped batch). */
  dropParentRate: number;
  ioScale: number;
}

export const SHAPES: Record<string, Shape> = {
  research: { name: "research-assistant", subAgentRate: 0.12, maxDepth: 4, toolsPerStep: [1, 4], errorRate: 0.04, fanOutRate: 0.01, fanOutSize: [20, 80], idleGap: [0, 2], dropParentRate: 0, ioScale: 1 },
  // Held-out shapes: written before the held-out run and never used while developing.
  fanout: { name: "batch-enricher", subAgentRate: 0.03, maxDepth: 2, toolsPerStep: [1, 2], errorRate: 0.08, fanOutRate: 0.08, fanOutSize: [200, 2500], idleGap: [0, 1], dropParentRate: 0, ioScale: 0.6 },
  deep: { name: "recursive-planner", subAgentRate: 0.45, maxDepth: 40, toolsPerStep: [1, 2], errorRate: 0.03, fanOutRate: 0, fanOutSize: [0, 0], idleGap: [0, 1], dropParentRate: 0, ioScale: 0.8 },
  lossy: { name: "overnight-migration", subAgentRate: 0.1, maxDepth: 5, toolsPerStep: [1, 3], errorRate: 0.06, fanOutRate: 0.02, fanOutSize: [50, 300], idleGap: [5, 600], dropParentRate: 0.004, ioScale: 1.2 },
};

const TOOLS = ["web_search", "fetch_page", "run_python", "sql_query", "read_file", "write_file", "vector_search", "send_email"];
const MODELS = ["gpt-4.1", "gpt-4.1-mini", "claude-sonnet-4-5", "claude-haiku-4-5"];
const WORDS = "the quarterly revenue table customer churn cohort retention pricing invoice region germany france latency index migration schema column backfill report summary chart anomaly forecast budget contract supplier shipment warehouse ticket escalation refund policy clause".split(" ");
// Failures a tool of that kind would plausibly report; any tool can also hit the generic ones.
const ERRORS: Record<string, string[]> = {
  sql_query: ["relation \"orders_2025\" does not exist", "canceling statement due to statement timeout"],
  fetch_page: ["HTTP 503 from fetch target", "TLS handshake timeout"],
  run_python: ["sandbox killed: memory limit exceeded", "ModuleNotFoundError: No module named 'polars'"],
  web_search: ["rate limit exceeded (429), retrying after backoff"],
  vector_search: ["index not ready: collection is rebuilding"],
  read_file: ["ENOENT: no such file or directory, open 'reports/q3.csv'"],
  write_file: ["EACCES: permission denied, open '/mnt/shared/out.md'"],
  send_email: ["SMTP 421: service not available, try again later"],
  "*": ["timeout after 30s waiting for upstream"],
};

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)],
    hex: (n: number) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join(""),
    logn: (median: number, sigma: number) => median * Math.exp(sigma * Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next())),
  };
}

type R = ReturnType<typeof rng>;

export interface SimSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startNs: bigint;
  endNs: bigint;
  attrs: Record<string, string | number>;
  error?: string;
}

function text(r: R, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(r.pick(WORDS));
  return out.join(" ");
}

/** Builds one trace of about `target` spans. Returns spans in the order an exporter would send them. */
export function generateTrace(seed: number, target: number, shape: Shape, startMs = Date.UTC(2026, 10, 2, 8, 0, 0)) {
  const r = rng(seed);
  const traceId = r.hex(32);
  const spans: SimSpan[] = [];
  const ns = (ms: number) => BigInt(Math.round(ms * 1000)) * 1000n;
  let count = 0;
  const id = () => r.hex(16);

  const generation = (parent: string, t: number, purpose: string) => {
    const model = r.pick(MODELS);
    const inTok = r.int(800, 12000);
    const outTok = r.int(40, 900);
    const ms = r.logn(1800, 0.6) + outTok * 8;
    const s: SimSpan = {
      traceId, spanId: id(), parentSpanId: parent, name: purpose, startNs: ns(t), endNs: ns(t + ms),
      attrs: {
        "langfuse.observation.type": "generation", "gen_ai.operation.name": "chat", "gen_ai.request.model": model,
        "gen_ai.usage.input_tokens": inTok, "gen_ai.usage.output_tokens": outTok,
        "langfuse.observation.input": JSON.stringify([{ role: "system", content: "You are a careful analyst." }, { role: "user", content: text(r, Math.round(r.int(60, 400) * shape.ioScale)) }]),
        "langfuse.observation.output": text(r, Math.round(r.int(20, 160) * shape.ioScale)),
      },
    };
    spans.push(s);
    count++;
    return t + ms;
  };

  const tool = (parent: string, t: number, name = r.pick(TOOLS), attempt = 1): number => {
    const sid = id();
    const ms = r.logn(name === "run_python" ? 2500 : name === "fetch_page" ? 900 : 180, 0.9);
    const fails = r.next() < shape.errorRate && attempt < 4;
    const s: SimSpan = {
      traceId, spanId: sid, parentSpanId: parent, name: `${name}`, startNs: ns(t), endNs: ns(t + ms),
      attrs: {
        "langfuse.observation.type": "tool", "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name,
        "langfuse.observation.input": JSON.stringify({ query: text(r, Math.round(r.int(4, 30) * shape.ioScale)), attempt }),
        "langfuse.observation.output": fails ? "" : text(r, Math.round(r.int(20, 220) * shape.ioScale)),
      },
      error: fails ? r.pick([...(ERRORS[name] ?? []), ...ERRORS["*"]]) : undefined,
    };
    spans.push(s);
    count++;
    let end = t + ms;
    if (name === "vector_search" && count < target) {
      const rs: SimSpan = {
        traceId, spanId: id(), parentSpanId: sid, name: "retrieve", startNs: ns(t + 5), endNs: ns(t + ms * 0.8),
        attrs: { "langfuse.observation.type": "retriever", "langfuse.observation.input": text(r, 10), "langfuse.observation.output": text(r, 80) },
      };
      spans.push(rs);
      count++;
    }
    if (fails && count < target) end = tool(parent, end + r.logn(400, 0.5) * attempt, name, attempt + 1);
    return end;
  };

  const agent = (parent: string | undefined, t0: number, depth: number, name: string, budget: number): number => {
    const sid = id();
    const s: SimSpan = {
      traceId, spanId: sid, parentSpanId: parent, name, startNs: ns(t0), endNs: 0n,
      attrs: { "langfuse.observation.type": "agent", "gen_ai.operation.name": "invoke_agent", "langfuse.observation.input": text(r, 30) },
    };
    spans.push(s);
    count++;
    let t = t0 + 5;
    const stop = count + budget;
    while (count < Math.min(stop, target)) {
      t = generation(sid, t, depth === 0 ? "plan next step" : "decide");
      if (count >= target) break;
      if (r.next() < shape.fanOutRate) {
        // A map over items: many overlapping calls under one span.
        const mapId = id();
        const n = r.int(shape.fanOutSize[0], shape.fanOutSize[1]);
        const mapStart = t;
        let mapEnd = t;
        const toolName = r.pick(TOOLS);
        for (let i = 0; i < n && count < target - 1; i++) mapEnd = Math.max(mapEnd, tool(mapId, mapStart + i * 3, toolName));
        spans.push({ traceId, spanId: mapId, parentSpanId: sid, name: `map ${toolName} over ${n} items`, startNs: ns(mapStart), endNs: ns(mapEnd), attrs: { "langfuse.observation.type": "chain" } });
        count++;
        t = mapEnd;
      } else if (depth < shape.maxDepth && r.next() < shape.subAgentRate) {
        t = agent(sid, t + 2, depth + 1, r.pick(["researcher", "coder", "reviewer", "data-analyst"]), Math.max(8, Math.floor((stop - count) / 3)));
      } else {
        const k = r.int(shape.toolsPerStep[0], shape.toolsPerStep[1]);
        for (let i = 0; i < k && count < target; i++) t = tool(sid, t + 3);
      }
      t += r.next() * (shape.idleGap[1] - shape.idleGap[0]) * 1000 + shape.idleGap[0] * 1000;
    }
    t = generation(sid, t, depth === 0 ? "write final answer" : "report back");
    s.endNs = ns(t + 2);
    s.attrs["langfuse.observation.output"] = text(r, 40);
    return t + 2;
  };

  agent(undefined, startMs, 0, shape.name, target);
  // Spans whose parent export was lost.
  if (shape.dropParentRate > 0) {
    const drop = new Set<string>();
    for (const s of spans) if (s.parentSpanId && r.next() < shape.dropParentRate) drop.add(s.parentSpanId);
    for (let i = spans.length - 1; i >= 0; i--) if (drop.has(spans[i].spanId) && spans[i].parentSpanId) spans.splice(i, 1);
  }
  // Exporters send spans as they end.
  spans.sort((a, b) => (a.endNs < b.endNs ? -1 : a.endNs > b.endNs ? 1 : 0));
  return { traceId, spans };
}

const attr = (k: string, v: string | number) =>
  typeof v === "number" ? (Number.isInteger(v) ? { key: k, value: { intValue: String(v) } } : { key: k, value: { doubleValue: v } }) : { key: k, value: { stringValue: v } };

/** OTLP/HTTP JSON request bodies of `batch` spans each. */
export function toOtlp(spans: SimSpan[], batch = 2000) {
  const out: unknown[] = [];
  for (let i = 0; i < spans.length; i += batch) {
    out.push({
      resourceSpans: [{
        resource: { attributes: [attr("service.name", "agent-worker"), attr("telemetry.sdk.language", "python")] },
        scopeSpans: [{
          scope: { name: "langfuse-sdk", version: "3.0.0" },
          spans: spans.slice(i, i + batch).map((s) => ({
            traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? "", name: s.name, kind: 1,
            startTimeUnixNano: s.startNs.toString(), endTimeUnixNano: s.endNs.toString(),
            attributes: Object.entries(s.attrs).map(([k, v]) => attr(k, v)),
            status: s.error ? { code: 2, message: s.error } : { code: 0 },
          })),
        }],
      }],
    });
  }
  return out;
}
