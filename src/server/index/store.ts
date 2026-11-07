import { ch, rows } from "../clickhouse";
import { buildIndex, type IndexInput } from "./build";

export interface Meta {
  version: string;
  spans: number;
  roots: number;
  orphans: number;
  max_depth: number;
  total_cost: number;
  total_tokens: string;
  errors: number;
  start_time: string;
  end_time: string;
  root_name: string;
  last_ingested: string;
  build_ms: number;
  format: number;
  last_ms: string;
}

/** Bumped when trace_nodes gains columns readers rely on; older indexes are rebuilt on first read. */
export const INDEX_FORMAT = 2;

export async function currentMeta(project: string, trace: string): Promise<Meta | null> {
  const r = await rows<Meta>(
    `SELECT * EXCEPT (project_id, trace_id), toString(toUnixTimestamp64Milli(last_ingested)) AS last_ms FROM trace_index_meta FINAL WHERE project_id = {p:String} AND trace_id = {t:String} LIMIT 1`,
    { p: project, t: trace },
  );
  return r[0] ?? null;
}

// The newest ingest time of a trace. Read without FINAL and only one column, so it stays cheap on
// large traces: a re-sent or late span always carries a newer ingested_at than the index.
async function lastIngest(project: string, trace: string): Promise<number | null> {
  const r = await rows<{ n: string; last_ms: string }>(
    `SELECT count() AS n, toString(toUnixTimestamp64Milli(max(ingested_at))) AS last_ms FROM observations WHERE project_id = {p:String} AND trace_id = {t:String}`,
    { p: project, t: trace },
  );
  return Number(r[0]?.n ?? 0) ? Number(r[0].last_ms) : null;
}

export class NotFound extends Error {}

/** Returns the index metadata, rebuilding the index first when spans arrived after it was built. */
export async function ensureIndex(project: string, trace: string): Promise<Meta & { rebuilt: boolean }> {
  const [meta, last] = await Promise.all([currentMeta(project, trace), lastIngest(project, trace)]);
  if (last === null) throw new NotFound(`no trace ${trace}`);
  if (meta && Number(meta.format) === INDEX_FORMAT && Number(meta.last_ms) >= last) {
    return { ...meta, rebuilt: false };
  }
  return { ...(await rebuild(project, trace, last)), rebuilt: true };
}

export async function rebuild(project: string, trace: string, lastIngestedMs?: number): Promise<Meta> {
  const t0 = performance.now();
  const input = await rows<{ id: string; parent_id: string; start_time: string; end_time: string; cost_usd: number; tokens: string; error: number;
    name: string; type: string; level: string; model: string; tool_name: string; status_message: string }>(
    `SELECT id, parent_id, toString(start_time) AS start_time, toString(end_time) AS end_time, cost_usd,
            input_tokens + output_tokens AS tokens, level = 'ERROR' AS error, name, type, level, model, tool_name,
            substring(status_message, 1, 200) AS status_message
       FROM observations FINAL WHERE project_id = {p:String} AND trace_id = {t:String}`,
    { p: project, t: trace },
  );
  const idx = buildIndex(input.map<IndexInput>((r) => ({ ...r, tokens: Number(r.tokens), error: Boolean(r.error) })));
  const shown = new Map(input.map((r) => [r.id, r]));
  const version = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const batch = 50_000;
  for (let i = 0; i < idx.nodes.length; i += batch) {
    await ch().insert({
      table: "trace_nodes",
      format: "JSONEachRow",
      values: idx.nodes.slice(i, i + batch).map((n) => {
        const o = shown.get(n.id)!;
        return {
          project_id: project, trace_id: trace, version, ...n, critical: n.critical ? 1 : 0, orphan: n.orphan ? 1 : 0,
          name: o.name, type: o.type, level: o.level, model: o.model, tool_name: o.tool_name,
          start_time: o.start_time, end_time: o.end_time, cost_usd: o.cost_usd, tokens: Number(o.tokens), status_message: o.status_message,
        };
      }),
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  }
  const rootName = input.find((r) => r.id === idx.nodes[0]?.id)?.name ?? "";
  const meta = {
    project_id: project, trace_id: trace, version, spans: idx.nodes.length, roots: idx.roots, orphans: idx.orphans,
    max_depth: idx.maxDepth, total_cost: idx.totalCost, total_tokens: idx.totalTokens, errors: idx.errors,
    start_time: idx.start, end_time: idx.end, root_name: rootName,
    last_ingested: new Date(lastIngestedMs ?? Date.now()).toISOString(), build_ms: Math.round(performance.now() - t0), format: INDEX_FORMAT,
  };
  await ch().insert({ table: "trace_index_meta", format: "JSONEachRow", values: [meta], clickhouse_settings: { date_time_input_format: "best_effort" } });
  // Older index versions of this trace are no longer read; remove them (lightweight delete).
  await ch().command({
    query: `DELETE FROM trace_nodes WHERE project_id = {p:String} AND trace_id = {t:String} AND version < {v:UInt64}`,
    query_params: { p: project, t: trace, v: version },
  });
  const fresh = await currentMeta(project, trace);
  if (!fresh) throw new Error("index metadata missing after rebuild");
  return fresh;
}
