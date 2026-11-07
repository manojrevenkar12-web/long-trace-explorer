// Server-side benchmark against a running explorer (`npm start`) and ClickHouse.
//   npm run bench -- --set dev       development shape at every configured size
//   npm run bench -- --pin           writes the held-out pin (shapes, sizes, seed and their hash)
//   npm run bench -- --set heldout   runs the pinned held-out shapes once; refuses a second run
// For every trace: ingest throughput, index build, the time and bytes to open the trace, expand a
// branch, search and draw the agent steps, against loading the whole trace in one response; plus
// correctness checks that compare what the explorer shows with what the generator produced.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rows } from "../src/server/clickhouse";
import { config } from "../src/server/config";
import { generateTrace, SHAPES, type Shape, type SimSpan } from "../src/sim/agent";
import { pct, send, timed } from "./lib";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? "" : null; };
const B = config().bench;
const PIN = "reports/heldout-pin.json";
const project = config().projects[0].id;
mkdirSync("reports", { recursive: true });

function heldoutPlan() {
  const shapes = B.heldout_shapes.map((k) => ({ key: k, shape: SHAPES[k] }));
  const plan = { shapes, spans: B.heldout_spans, seed: B.heldout_seed, repeats: B.repeats, search: "rate limit" };
  return { plan, sha256: createHash("sha256").update(JSON.stringify(plan)).digest("hex") };
}

if (process.argv.includes("--pin")) {
  const { plan, sha256 } = heldoutPlan();
  if (existsSync(PIN)) throw new Error(`${PIN} exists; the held-out plan is pinned once`);
  writeFileSync(PIN, JSON.stringify({ sha256, pinned_at: new Date().toISOString(), plan }, null, 2) + "\n");
  console.log(`pinned ${sha256}`);
  process.exit(0);
}

const set = arg("--set");
if (set !== "dev" && set !== "heldout") throw new Error("use --set dev, --set heldout or --pin");
const out = `reports/bench-${set}.json`;

let runs: { key: string; shape: Shape; spans: number; seed: number }[];
if (set === "dev") {
  runs = B.sizes.map((n, i) => ({ key: "research", shape: SHAPES.research, spans: n, seed: B.dev_seed + i }));
} else {
  if (!existsSync(PIN)) throw new Error("pin the held-out plan first: npm run bench -- --pin");
  if (existsSync(out)) throw new Error(`${out} exists: the held-out set runs once`);
  const pin = JSON.parse(readFileSync(PIN, "utf8"));
  const { sha256 } = heldoutPlan();
  if (pin.sha256 !== sha256) throw new Error(`held-out plan changed since it was pinned (${pin.sha256} vs ${sha256})`);
  runs = B.heldout_shapes.map((k, i) => ({ key: k, shape: SHAPES[k], spans: B.heldout_spans, seed: B.heldout_seed + i }));
}

function chain(byId: Map<string, SimSpan>, id: string): string[] {
  const out: string[] = [];
  let p = byId.get(id)?.parentSpanId;
  while (p && byId.has(p) && out.length < 10_000) { out.push(p); p = byId.get(p)!.parentSpanId; }
  return out.reverse();
}

async function repeat(path: string, n: number) {
  const ms: number[] = [];
  let last = { bytes: 0, body: "" };
  for (let i = 0; i < n; i++) {
    const r = await timed(path);
    if (r.status !== 200) throw new Error(`${path}: HTTP ${r.status} ${r.body.slice(0, 300)}`);
    ms.push(r.ms);
    last = r;
  }
  return { ...pct(ms), bytes: last.bytes, body: last.body };
}

/** Walks the whole tree over the children endpoint: every span must appear once, under its own parent. */
async function walk(traceId: string, byId: Map<string, SimSpan>): Promise<boolean> {
  const seen = new Map<string, string>();
  const visit = async (parent: string) => {
    let after: number | null = null;
    do {
      const q = `/api/traces/${traceId}/children?limit=2000${parent ? `&parent=${parent}` : ""}${after !== null ? `&after=${after}` : ""}`;
      const page = JSON.parse((await timed(q)).body) as { rows: { id: string; child_count: number }[]; next: number | null };
      for (const r of page.rows) {
        if (seen.has(r.id)) return false;
        seen.set(r.id, parent);
        if (r.child_count && !(await visit(r.id))) return false;
      }
      after = page.next;
    } while (after !== null);
    return true;
  };
  if (!(await visit(""))) return false;
  if (seen.size !== byId.size) return false;
  for (const [id, p] of seen) {
    const want = byId.get(id)?.parentSpanId;
    if ((want && byId.has(want) ? want : "") !== p) return false;
  }
  return true;
}

/** For big traces: the stored index has every span exactly once, nested inside its parent's range. */
async function indexHolds(traceId: string, version: string, byId: Map<string, SimSpan>): Promise<boolean> {
  const p = { p: project, t: traceId, v: version };
  const [c] = await rows<{ c: string; u: string; bad: string }>(
    `SELECT count() AS c, uniqExact(id) AS u,
            (SELECT count() FROM trace_nodes n INNER JOIN (SELECT id, pre, post, depth FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64}) AS q ON n.parent_id = q.id
              WHERE n.project_id = {p:String} AND n.trace_id = {t:String} AND n.version = {v:UInt64} AND n.orphan = 0
                AND NOT (q.pre < n.pre AND n.post <= q.post AND n.depth = q.depth + 1)) AS bad
       FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64}`, p);
  if (Number(c.c) !== byId.size || Number(c.u) !== byId.size || Number(c.bad) !== 0) return false;
  const nodes = await rows<{ id: string; parent_id: string; orphan: number }>(
    `SELECT id, parent_id, orphan FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64}`, p);
  return nodes.every((n) => {
    const want = byId.get(n.id)?.parentSpanId;
    const has = Boolean(want && byId.has(want));
    return has ? n.parent_id === want && !n.orphan : n.orphan === (want ? 1 : 0);
  });
}

const results = [];
for (const run of runs) {
  const t0 = performance.now();
  const { traceId, spans } = generateTrace(run.seed, run.spans, run.shape);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const sendMs = await send(spans);
  const cold = await timed(`/api/traces/${traceId}/summary`);
  const coldBody = JSON.parse(cold.body);
  const open = await repeat(`/api/traces/${traceId}/summary`, B.repeats);
  const summary = JSON.parse(open.body) as { meta: { version: string; spans: number; errors: number; total_cost: number }; expanded: string[]; pages: { rows: { id: string; child_count: number; subtree_size: number }[]; total: number }[] };

  const expanded = new Set(summary.expanded);
  const candidates = summary.pages.flatMap((p) => p.rows).filter((r) => r.child_count > 0 && !expanded.has(r.id)).slice(0, B.repeats);
  const expandMs: number[] = [];
  for (const c of candidates) expandMs.push((await timed(`/api/traces/${traceId}/children?parent=${c.id}`)).ms);

  const search = await repeat(`/api/traces/${traceId}/search?q=${encodeURIComponent("rate limit")}`, B.repeats);
  const hits = (JSON.parse(search.body) as { hits: { id: string; ancestors: { id: string }[] }[] }).hits;
  const graph = await repeat(`/api/traces/${traceId}/graph`, B.repeats);
  const fullRuns = run.spans >= 100_000 ? Math.min(3, B.repeats) : B.repeats;
  const full = await repeat(`/api/traces/${traceId}/full`, fullRuns);
  const fullIO = run.spans <= B.full_with_io_max ? await repeat(`/api/traces/${traceId}/full?io=1`, B.repeats) : null;

  const [truth] = await rows<{ cost: number; errors: string }>(
    `SELECT sum(cost_usd) AS cost, countIf(level = 'ERROR') AS errors FROM observations FINAL WHERE project_id = {p:String} AND trace_id = {t:String}`, { p: project, t: traceId });
  const top = summary.pages[0];
  const topComplete = top.rows.length === top.total;
  const correct = {
    every_span_once: run.spans <= B.walk_max ? await walk(traceId, byId) : await indexHolds(traceId, summary.meta.version, byId),
    totals_match: summary.meta.spans === spans.length && summary.meta.errors === spans.filter((s) => s.error).length
      && Number(truth.errors) === summary.meta.errors && Math.abs(truth.cost - summary.meta.total_cost) < 1e-6
      && (!topComplete || top.rows.reduce((a, r) => a + r.subtree_size, 0) === spans.length),
    search_reveals: hits.length > 0 && hits.every((h) => JSON.stringify(h.ancestors.map((a) => a.id)) === JSON.stringify(chain(byId, h.id))),
  };
  const row = {
    set, shape: run.shape.name, spans: spans.length, trace_id: traceId,
    ingest_spans_per_s: Math.round(spans.length / (sendMs / 1000)),
    index_build_ms: coldBody.meta.build_ms as number, cold_open_ms: Math.round(cold.ms),
    open_ms: { p50: open.p50, p95: open.p95 }, open_bytes: open.bytes,
    expand_ms: pct(expandMs.length ? expandMs : [0]),
    search_ms: { p50: search.p50, p95: search.p95 }, search_hits: hits.length,
    graph_ms: { p50: graph.p50, p95: graph.p95 },
    full_ms: { p50: full.p50, p95: full.p95 }, full_bytes: full.bytes,
    full_io_ms: fullIO && { p50: fullIO.p50, p95: fullIO.p95 }, full_io_bytes: fullIO?.bytes ?? null,
    correct,
  };
  results.push(row);
  console.log(JSON.stringify({ ...row, wall_s: Math.round((performance.now() - t0) / 1000) }));
}
writeFileSync(out, JSON.stringify({ set, generated_at: new Date().toISOString(), rows: results }, null, 2) + "\n");
console.log(`wrote ${out}`);
process.exit(0);
