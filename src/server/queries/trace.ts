import { rows } from "../clickhouse";
import { config } from "../config";
import { ensureIndex, NotFound, type Meta } from "../index/store";

export { NotFound };

export interface Row {
  id: string;
  parent_id: string;
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
  critical: number;
  orphan: number;
  name: string;
  type: string;
  level: string;
  model: string;
  tool_name: string;
  start_time: string;
  end_time: string;
  cost_usd: number;
  tokens: number;
  status_message: string;
}

export interface Page {
  parent: string; // "" for the top level
  rows: Row[];
  next: number | null; // cursor (last pre) when more children exist
  total: number;
}

const NODE_COLS = `id, parent_id, pre, post, depth, child_count, subtree_size, subtree_cost, toUInt64(subtree_tokens) AS subtree_tokens,
  subtree_errors, toString(subtree_start) AS subtree_start, toString(subtree_end) AS subtree_end, critical, orphan,
  name, type, level, model, tool_name, toString(start_time) AS start_time, toString(end_time) AS end_time, cost_usd, tokens, status_message`;

// ClickHouse returns UInt64 as strings in JSON.
const asRow = (r: Row): Row => ({ ...r, tokens: Number(r.tokens), subtree_tokens: Number(r.subtree_tokens) });

/** One page of a node's children (or of the top level), in time order. */
export async function children(project: string, trace: string, meta: Meta, parent: Row | null, after: number | null, limit?: number): Promise<Page> {
  const lim = Math.min(limit ?? config().children_page, 2000);
  const lo = parent ? parent.pre + 1 : 0;
  const hi = parent ? parent.post : 0xffffffff;
  const depth = parent ? parent.depth + 1 : 0;
  const nodes = await rows<Row>(
    `SELECT ${NODE_COLS} FROM trace_nodes
      WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64}
        AND pre BETWEEN {lo:UInt32} AND {hi:UInt32} AND depth = {d:UInt16} AND pre > {after:Int64}
      ORDER BY pre LIMIT {lim:UInt32}`,
    { p: project, t: trace, v: meta.version, lo, hi, d: depth, after: after ?? -1, lim: lim + 1 },
  );
  const more = nodes.length > lim;
  const page = more ? nodes.slice(0, lim) : nodes;
  const total = parent ? parent.child_count : meta.roots;
  return { parent: parent?.id ?? "", rows: page.map(asRow), next: more ? page[page.length - 1].pre : null, total };
}

export async function node(project: string, trace: string, meta: Meta, id: string): Promise<Row | null> {
  const n = await rows<Row>(
    `SELECT ${NODE_COLS} FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64} AND id = {id:String} LIMIT 1`,
    { p: project, t: trace, v: meta.version, id },
  );
  return n.length ? asRow(n[0]) : null;
}

/** What the first screen needs: totals, the top level, and the critical path opened a few levels deep. */
export async function summary(project: string, trace: string) {
  const t0 = performance.now();
  const meta = await ensureIndex(project, trace);
  const indexMs = performance.now() - t0;
  const [top, crit] = await Promise.all([children(project, trace, meta, null, null), rows<Row>(
    `SELECT ${NODE_COLS} FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64}
        AND critical = 1 AND depth < {d:UInt16} AND child_count > 0 ORDER BY pre`,
    { p: project, t: trace, v: meta.version, d: config().auto_expand_depth },
  )]);
  const pages: Page[] = [top];
  const critRows = crit.map(asRow);
  const opened = await Promise.all(critRows.map((r) => children(project, trace, meta, r, null)));
  pages.push(...opened);
  // Make sure each opened node is itself visible: its own row must be on its parent's first page.
  const visible = new Set(pages.flatMap((p) => p.rows.map((r) => r.id)));
  const expanded = critRows.filter((r) => r.depth === 0 || visible.has(r.id)).map((r) => r.id);
  return { meta, rebuilt: meta.rebuilt, index_ms: Math.round(indexMs), pages, expanded, critical: critRows.map((r) => r.id) };
}

export interface Hit {
  id: string;
  pre: number;
  name: string;
  type: string;
  level: string;
  field: string;
  ancestors: { id: string; pre: number }[];
}

/** Matches in names, tools, models, errors, input and output; each hit comes with the branch to open. */
export async function search(project: string, trace: string, q: string): Promise<{ hits: Hit[]; truncated: boolean }> {
  const meta = await ensureIndex(project, trace);
  const lim = config().search_limit;
  const hits = await rows<{ id: string; name: string; type: string; level: string; field: string }>(
    `SELECT id, name, type, level,
            multiIf(positionCaseInsensitiveUTF8(name, {q:String}) > 0, 'name',
                    positionCaseInsensitiveUTF8(tool_name, {q:String}) > 0, 'tool',
                    positionCaseInsensitiveUTF8(model, {q:String}) > 0, 'model',
                    positionCaseInsensitiveUTF8(status_message, {q:String}) > 0, 'error',
                    positionCaseInsensitiveUTF8(input, {q:String}) > 0, 'input', 'output') AS field
       FROM observations FINAL
      WHERE project_id = {p:String} AND trace_id = {t:String}
        AND (positionCaseInsensitiveUTF8(name, {q:String}) > 0 OR positionCaseInsensitiveUTF8(tool_name, {q:String}) > 0
          OR positionCaseInsensitiveUTF8(model, {q:String}) > 0 OR positionCaseInsensitiveUTF8(status_message, {q:String}) > 0
          OR positionCaseInsensitiveUTF8(input, {q:String}) > 0 OR positionCaseInsensitiveUTF8(output, {q:String}) > 0)
      ORDER BY start_time LIMIT {lim:UInt32}`,
    { p: project, t: trace, q, lim: lim + 1 },
  );
  const truncated = hits.length > lim;
  const page = hits.slice(0, lim);
  if (!page.length) return { hits: [], truncated };
  const pres = await rows<{ id: string; pre: number }>(
    `SELECT id, pre FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64} AND id IN {ids:Array(String)}`,
    { p: project, t: trace, v: meta.version, ids: page.map((h) => h.id) },
  );
  const preById = new Map(pres.map((r) => [r.id, r.pre]));
  // Ancestors of a node are exactly the nodes whose [pre, post] interval contains its pre.
  const anc = await rows<{ h: number; ids: [number, string][] }>(
    `SELECT h, arraySort(x -> x.1, groupArray((pre, id))) AS ids
       FROM trace_nodes ARRAY JOIN {hs:Array(UInt32)} AS h
      WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64} AND pre < h AND post >= h
      GROUP BY h`,
    { p: project, t: trace, v: meta.version, hs: [...preById.values()] },
  );
  const ancByPre = new Map(anc.map((a) => [Number(a.h), a.ids.map(([pre, id]) => ({ id, pre: Number(pre) }))]));
  return {
    truncated,
    hits: page.map((h) => {
      const pre = preById.get(h.id) ?? -1;
      return { ...h, pre, ancestors: ancByPre.get(pre) ?? [] };
    }),
  };
}

/** The agent's moves: for every agent span, which step follows which, with counts, errors and cost. */
export async function graph(project: string, trace: string) {
  const meta = await ensureIndex(project, trace);
  const params = { p: project, t: trace, v: meta.version };
  const label = `multiIf(type = 'TOOL', concat('tool: ', if(tool_name = '', name, tool_name)), type = 'GENERATION', concat('llm: ', if(model = '', name, model)),
                         type = 'AGENT', concat('agent: ', name), concat(lower(type), ': ', name))`;
  const kids = `SELECT parent_id, id, start_time, ${label} AS label, level = 'ERROR' AS err, dateDiff('millisecond', start_time, end_time) AS ms, cost_usd
                  FROM trace_nodes
                 WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64} AND orphan = 0
                   AND parent_id IN (SELECT id FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version = {v:UInt64} AND type = 'AGENT')`;
  const [nodes, edges] = await Promise.all([
    rows<{ label: string; calls: string; errors: string; p50_ms: number; p95_ms: number; cost: number }>(
      `SELECT label, count() AS calls, countIf(err) AS errors, quantile(0.5)(ms) AS p50_ms, quantile(0.95)(ms) AS p95_ms, sum(cost_usd) AS cost
         FROM (${kids}) GROUP BY label ORDER BY calls DESC LIMIT 40`,
      params,
    ),
    rows<{ from: string; to: string; n: string }>(
      `SELECT prev AS from, label AS to, count() AS n FROM (
         SELECT label, lagInFrame(label, 1, 'start') OVER (PARTITION BY parent_id ORDER BY start_time, id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS prev
           FROM (${kids}))
        GROUP BY from, to ORDER BY n DESC LIMIT 120`,
      params,
    ),
  ]);
  return {
    nodes: nodes.map((n) => ({ ...n, calls: Number(n.calls), errors: Number(n.errors) })),
    edges: edges.map((e) => ({ ...e, n: Number(e.n) })),
  };
}

export async function detail(project: string, trace: string, id: string) {
  const preview = config().io_preview_bytes;
  const r = await rows<Record<string, unknown>>(
    `SELECT id, parent_id, name, type, level, status_message, toString(start_time) AS start_time, toString(end_time) AS end_time,
            model, tool_name, input_tokens, output_tokens, cost_usd, attributes,
            substring(input, 1, {n:UInt32}) AS input, length(input) AS input_bytes,
            substring(output, 1, {n:UInt32}) AS output, length(output) AS output_bytes
       FROM observations FINAL WHERE project_id = {p:String} AND trace_id = {t:String} AND id = {id:String} LIMIT 1`,
    { p: project, t: trace, id, n: preview },
  );
  return r[0] ?? null;
}

/** The baseline: every observation of the trace at once, as a classic trace view loads it. */
export async function full(project: string, trace: string, withIO: boolean) {
  const cols = `id, parent_id, name, type, level, model, tool_name, toString(start_time) AS start_time, toString(end_time) AS end_time,
                cost_usd, input_tokens + output_tokens AS tokens, status_message${withIO ? ", input, output" : ""}`;
  return rows<Record<string, unknown>>(
    `SELECT ${cols} FROM observations FINAL WHERE project_id = {p:String} AND trace_id = {t:String} ORDER BY start_time LIMIT {lim:UInt32}`,
    { p: project, t: trace, lim: config().full_trace_row_limit },
  );
}

export async function listTraces(project: string, limit = 50) {
  return rows<{ trace_id: string; spans: string; first: string; last: string; cost: number; errors: string; root_name: string }>(
    `SELECT trace_id, count() AS spans, toString(min(start_time)) AS first, toString(max(end_time)) AS last, sum(cost_usd) AS cost,
            countIf(level = 'ERROR') AS errors, argMinIf(name, start_time, parent_id = '') AS root_name
       FROM observations FINAL WHERE project_id = {p:String} GROUP BY trace_id ORDER BY max(end_time) DESC LIMIT {lim:UInt32}`,
    { p: project, lim: limit },
  );
}
