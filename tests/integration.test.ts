// End to end against a real ClickHouse (CLICKHOUSE_URL, default http://127.0.0.1:8123): ingest a
// generated agent trace, then check that paging the tree returns every span exactly once, that
// branch totals and search ancestors are right, and that late spans trigger a rebuild.
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@clickhouse/client";

process.env.CLICKHOUSE_DB = "lte_test";
const { migrate } = await import("@/src/server/schema");
const { normalise } = await import("@/src/server/ingest/otlp");
const { insertObservations } = await import("@/src/server/ingest/insert");
const q = await import("@/src/server/queries/trace");
type Row = import("@/src/server/queries/trace").Row;
type Page = import("@/src/server/queries/trace").Page;
const { ensureIndex } = await import("@/src/server/index/store");
const { generateTrace, toOtlp, SHAPES } = await import("@/src/sim/agent");

const url = process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123";
let available = true;
const P = `itest${Date.now()}`;

beforeAll(async () => {
  const admin = createClient({ url });
  try {
    await admin.command({ query: "CREATE DATABASE IF NOT EXISTS lte_test" });
    await migrate();
  } catch {
    available = false;
  } finally {
    await admin.close();
  }
});

async function ingest(seed: number, n: number, shape = SHAPES.research) {
  const { traceId, spans } = generateTrace(seed, n, shape);
  for (const body of toOtlp(spans, 700)) await insertObservations(normalise(body as never, P, {}));
  return { traceId, spans };
}

describe.runIf(available)("against ClickHouse", () => {
  it("pages the whole tree: every span exactly once, under its own parent", async () => {
    const { traceId, spans } = await ingest(11, 3000);
    const meta = await ensureIndex(P, traceId);
    expect(meta.spans).toBe(spans.length);
    const seen = new Map<string, string>();
    const walk = async (parent: Row | null) => {
      let after: number | null = null;
      do {
        const page: Page = await q.children(P, traceId, meta, parent, after, 37);
        for (const r of page.rows) {
          expect(seen.has(r.id)).toBe(false);
          seen.set(r.id, parent?.id ?? "");
          if (r.child_count) await walk(r);
        }
        after = page.next;
      } while (after !== null);
    };
    await walk(null);
    expect(seen.size).toBe(spans.length);
    for (const s of spans) expect(seen.get(s.spanId)).toBe(s.parentSpanId ?? "");
  });

  it("branch totals equal the sum of the branch, and the summary opens the critical path", async () => {
    const { traceId, spans } = await ingest(12, 2000);
    const s = await q.summary(P, traceId);
    const root = s.pages[0].rows[0];
    const tokens = spans.reduce((a, x) => a + Number(x.attrs["gen_ai.usage.input_tokens"] ?? 0) + Number(x.attrs["gen_ai.usage.output_tokens"] ?? 0), 0);
    expect(root.subtree_size).toBe(spans.length);
    expect(root.subtree_tokens).toBe(tokens);
    expect(root.subtree_errors).toBe(spans.filter((x) => x.error).length);
    expect(s.expanded[0]).toBe(root.id);
    expect(s.pages.length).toBeGreaterThan(2);
  });

  it("search finds a span and returns the branch to open, root first", async () => {
    const { traceId, spans } = await ingest(13, 1500);
    const failing = spans.find((x) => x.error)!;
    const res = await q.search(P, traceId, failing.error!.slice(0, 18));
    const hit = res.hits.find((h) => h.id === failing.spanId)!;
    expect(hit.field).toBe("error");
    const parentOf = new Map(spans.map((x) => [x.spanId, x.parentSpanId ?? ""]));
    const chain: string[] = [];
    for (let p = parentOf.get(hit.id)!; p; p = parentOf.get(p)!) chain.unshift(p);
    expect(hit.ancestors.map((a) => a.id)).toEqual(chain);
    expect(hit.ancestors.every((a, i) => i === 0 || a.pre > hit.ancestors[i - 1].pre)).toBe(true);
  });

  it("rebuilds the index when spans arrive after it was built", async () => {
    const { traceId, spans } = generateTrace(14, 800, SHAPES.research);
    const [first, ...rest] = toOtlp(spans, 400);
    await insertObservations(normalise(first as never, P, {}));
    const before = await ensureIndex(P, traceId);
    for (const b of rest) await insertObservations(normalise(b as never, P, {}));
    const after = await ensureIndex(P, traceId);
    expect(after.rebuilt).toBe(true);
    expect(after.spans).toBe(spans.length);
    expect(before.spans).toBeLessThan(spans.length);
    expect((await ensureIndex(P, traceId)).rebuilt).toBe(false);
  });

  it("the agent graph counts every step under agent spans", async () => {
    const { traceId, spans } = await ingest(15, 1200);
    const g = await q.graph(P, traceId);
    const agents = new Set(spans.filter((x) => x.attrs["langfuse.observation.type"] === "agent").map((x) => x.spanId));
    const steps = spans.filter((x) => x.parentSpanId && agents.has(x.parentSpanId)).length;
    expect(g.nodes.reduce((a, n) => a + n.calls, 0)).toBe(steps);
    expect(g.edges.filter((e) => e.from === "start").reduce((a, e) => a + e.n, 0)).toBe(agents.size);
  });

  it("re-sent batches do not duplicate spans", async () => {
    const { traceId, spans } = generateTrace(16, 300, SHAPES.research);
    const bodies = toOtlp(spans, 100);
    for (const b of [...bodies, bodies[1]]) await insertObservations(normalise(b as never, P, {}));
    expect((await ensureIndex(P, traceId)).spans).toBe(spans.length);
    expect((await q.full(P, traceId, false)).length).toBe(spans.length);
  });
});
