// Builds the trace index in one pass over a trace's observations: DFS order, depth, and the totals
// of every branch. Pure and synchronous so it can be tested without a database.

export interface IndexInput {
  id: string;
  parent_id: string;
  start_time: string; // sortable ISO
  end_time: string;
  cost_usd: number;
  tokens: number;
  error: boolean;
}

export interface IndexNode {
  id: string;
  parent_id: string; // "" for roots; for orphans, the missing parent's id is kept
  pre: number;
  post: number;
  depth: number;
  child_count: number;
  subtree_size: number;
  subtree_cost: number;
  subtree_tokens: number;
  subtree_errors: number;
  subtree_start: string;
  subtree_end: string;
  critical: boolean;
  orphan: boolean;
}

export interface IndexResult {
  nodes: IndexNode[]; // in pre order
  roots: number;
  orphans: number;
  maxDepth: number;
  totalCost: number;
  totalTokens: number;
  errors: number;
  start: string;
  end: string;
}

/** Milliseconds from an ISO-like timestamp ("2026-11-02 08:00:00.123456" or with a T), or a plain number. */
export function toMs(t: string): number {
  if (/^\d+$/.test(t)) return Number(t);
  return Date.parse(t.replace(" ", "T").slice(0, 23) + "Z");
}

const byStart = (a: IndexInput, b: IndexInput) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildIndex(input: IndexInput[]): IndexResult {
  const byId = new Map<string, IndexInput>();
  for (const o of input) byId.set(o.id, o); // a duplicate id keeps the last copy
  const obs = [...byId.values()];
  const children = new Map<string, IndexInput[]>();
  const tops: IndexInput[] = [];
  let orphans = 0;
  const orphanSet = new Set<string>();
  for (const o of obs) {
    if (o.parent_id && byId.has(o.parent_id) && o.parent_id !== o.id) {
      let c = children.get(o.parent_id);
      if (!c) children.set(o.parent_id, (c = []));
      c.push(o);
    } else {
      // A root, or a span whose parent never arrived: shown at the top, marked, never dropped.
      if (o.parent_id) {
        orphans++;
        orphanSet.add(o.id);
      }
      tops.push(o);
    }
  }
  // A cycle (a -> b -> a) has no root; break it at its earliest span so nothing is lost.
  const reached = new Set<string>();
  const nodes: IndexNode[] = [];
  const order = (list: IndexInput[]) => list.sort(byStart);
  const visit = (rootList: IndexInput[]) => {
    // Iterative DFS: traces can be tens of thousands of levels deep in pathological cases.
    type Frame = { o: IndexInput; depth: number; node: IndexNode; kids: IndexInput[]; i: number };
    for (const top of order(rootList)) {
      if (reached.has(top.id)) continue;
      const stack: Frame[] = [];
      const push = (o: IndexInput, depth: number) => {
        reached.add(o.id);
        const kids = order((children.get(o.id) ?? []).filter((k) => !reached.has(k.id)));
        const node: IndexNode = {
          id: o.id, parent_id: o.parent_id, pre: nodes.length, post: nodes.length, depth,
          child_count: kids.length, subtree_size: 1, subtree_cost: o.cost_usd, subtree_tokens: o.tokens,
          subtree_errors: o.error ? 1 : 0, subtree_start: o.start_time, subtree_end: o.end_time, critical: false,
          orphan: orphanSet.has(o.id),
        };
        nodes.push(node);
        stack.push({ o, depth, node, kids, i: 0 });
      };
      push(top, 0);
      while (stack.length) {
        const f = stack[stack.length - 1];
        if (f.i < f.kids.length) {
          const k = f.kids[f.i++];
          if (!reached.has(k.id)) push(k, f.depth + 1);
          continue;
        }
        stack.pop();
        f.node.post = nodes.length - 1;
        const parent = stack[stack.length - 1];
        if (parent) {
          const p = parent.node, n = f.node;
          p.subtree_size += n.subtree_size;
          p.subtree_cost += n.subtree_cost;
          p.subtree_tokens += n.subtree_tokens;
          p.subtree_errors += n.subtree_errors;
          if (n.subtree_start < p.subtree_start) p.subtree_start = n.subtree_start;
          if (n.subtree_end > p.subtree_end) p.subtree_end = n.subtree_end;
        }
      }
    }
  };
  visit(tops);
  const unreached = obs.filter((o) => !reached.has(o.id));
  if (unreached.length) {
    for (const o of unreached) orphanSet.add(o.id);
    orphans += new Set(unreached.map((o) => o.id)).size;
    // Visit cycle members as tops in time order; each pulls in the rest of its cycle.
    visit(unreached);
  }
  // Heaviest path ("where the time went"): from the longest top-level node, keep stepping into the
  // child whose branch took longest. The first screen opens it, so a slow sub-agent is visible at once.
  const byPre = nodes;
  const rootNodes = byPre.filter((n) => n.depth === 0);
  const dur = (n: IndexNode) => toMs(n.subtree_end) - toMs(n.subtree_start);
  let cur = rootNodes.reduce<IndexNode | undefined>((a, b) => (!a || dur(b) > dur(a) ? b : a), undefined);
  while (cur) {
    cur.critical = true;
    let next: IndexNode | undefined;
    let i = cur.pre + 1;
    while (i <= cur.post) {
      const c = byPre[i];
      if (!next || dur(c) > dur(next)) next = c;
      i = c.post + 1;
    }
    cur = next;
  }
  let maxDepth = 0, cost = 0, tokens = 0, errors = 0;
  let start = "", end = "";
  for (const r of rootNodes) {
    cost += r.subtree_cost;
    tokens += r.subtree_tokens;
    errors += r.subtree_errors;
    if (!start || r.subtree_start < start) start = r.subtree_start;
    if (!end || r.subtree_end > end) end = r.subtree_end;
  }
  for (const n of nodes) if (n.depth > maxDepth) maxDepth = n.depth;
  return { nodes, roots: rootNodes.length, orphans, maxDepth, totalCost: cost, totalTokens: tokens, errors, start, end };
}
