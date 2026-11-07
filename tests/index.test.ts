import { describe, expect, it } from "vitest";
import { buildIndex, type IndexInput } from "@/src/server/index/build";
import { rng } from "@/src/sim/agent";

function randomForest(seed: number, n: number, opts: { orphans?: number; cycle?: boolean; dupes?: number } = {}): IndexInput[] {
  const r = rng(seed);
  const out: IndexInput[] = [];
  for (let i = 0; i < n; i++) {
    const parent = i === 0 || r.next() < 0.02 ? "" : out[r.int(Math.max(0, i - 50), i - 1)].id;
    const start = 1000 + i * 3 + r.int(0, 5);
    out.push({ id: `s${i}`, parent_id: parent, start_time: String(start).padStart(9, "0"), end_time: String(start + r.int(1, 500)).padStart(9, "0"),
      cost_usd: r.next(), tokens: r.int(0, 100), error: r.next() < 0.05 });
  }
  for (let k = 0; k < (opts.orphans ?? 0); k++) out[r.int(1, n - 1)].parent_id = `missing${k}`;
  if (opts.cycle) {
    out.push({ id: "c1", parent_id: "c2", start_time: "000000001", end_time: "000000002", cost_usd: 1, tokens: 1, error: false });
    out.push({ id: "c2", parent_id: "c1", start_time: "000000003", end_time: "000000004", cost_usd: 1, tokens: 1, error: false });
  }
  for (let k = 0; k < (opts.dupes ?? 0); k++) out.push({ ...out[r.int(0, n - 1)] });
  return out;
}

function check(input: IndexInput[]) {
  const idx = buildIndex(input);
  const unique = new Map(input.map((o) => [o.id, o]));
  // Every observation exactly once, pre order contiguous.
  expect(idx.nodes.length).toBe(unique.size);
  expect(new Set(idx.nodes.map((n) => n.id)).size).toBe(unique.size);
  idx.nodes.forEach((n, i) => expect(n.pre).toBe(i));
  // Branch totals equal a brute-force sum over the [pre, post] interval, which must be the subtree.
  const byId = new Map(idx.nodes.map((n) => [n.id, n]));
  for (const n of idx.nodes) {
    const span = idx.nodes.slice(n.pre, n.post + 1);
    expect(n.subtree_size).toBe(span.length);
    const cost = span.reduce((s, x) => s + unique.get(x.id)!.cost_usd, 0);
    expect(n.subtree_cost).toBeCloseTo(cost, 9);
    expect(n.subtree_errors).toBe(span.filter((x) => unique.get(x.id)!.error).length);
    for (const x of span.slice(1)) {
      // Each member's parent chain reaches n.
      let p = byId.get(x.id)!;
      let guard = 0;
      while (p.id !== n.id && guard++ < 1e6) p = byId.get(unique.get(p.id)!.parent_id)!;
      expect(p.id).toBe(n.id);
      expect(x.depth).toBeGreaterThan(n.depth);
    }
  }
  // Siblings in time order.
  for (const n of idx.nodes) {
    const kids: string[] = [];
    for (let i = n.pre + 1; i <= n.post; i = idx.nodes[i].post + 1) kids.push(unique.get(idx.nodes[i].id)!.start_time);
    expect([...kids].sort()).toEqual(kids);
    expect(kids.length).toBe(n.child_count);
  }
  // The heaviest path is one chain from a top-level node.
  const crit = idx.nodes.filter((n) => n.critical);
  expect(crit[0].depth).toBe(0);
  crit.forEach((c, i) => i > 0 && expect(unique.get(c.id)!.parent_id).toBe(crit[i - 1].id));
  return idx;
}

describe("trace index", () => {
  it("matches brute force on random traces", () => {
    for (let s = 1; s <= 20; s++) check(randomForest(s, 300));
  });

  it("keeps spans whose parent never arrived, as marked top-level nodes", () => {
    const idx = check(randomForest(3, 400, { orphans: 7 }));
    expect(idx.orphans).toBe(7);
    expect(idx.nodes.filter((n) => n.orphan).every((n) => n.depth === 0)).toBe(true);
  });

  it("survives a parent cycle and duplicate exports without losing or doubling a span", () => {
    const idx = check(randomForest(4, 200, { cycle: true, dupes: 15 }));
    expect(idx.nodes.some((n) => n.id === "c1") && idx.nodes.some((n) => n.id === "c2")).toBe(true);
  });

  it("handles a chain 50,000 deep without recursion", () => {
    const n = 50_000;
    const input: IndexInput[] = Array.from({ length: n }, (_, i) => ({
      id: `d${i}`, parent_id: i ? `d${i - 1}` : "", start_time: String(i).padStart(9, "0"), end_time: String(i + 1).padStart(9, "0"), cost_usd: 1, tokens: 1, error: false,
    }));
    const idx = buildIndex(input);
    expect(idx.maxDepth).toBe(n - 1);
    expect(idx.nodes[0].subtree_size).toBe(n);
  });
});
