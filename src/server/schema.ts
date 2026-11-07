import { ch } from "./clickhouse";

// Observations are immutable: an OpenTelemetry span is exported once, when it ends. Re-sent batches
// are collapsed by ReplacingMergeTree; trace-scoped reads use FINAL, which is cheap because the
// sorting key starts with (project_id, trace_id).
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS observations (
    project_id LowCardinality(String),
    trace_id String,
    id String,
    parent_id String,
    name String,
    type LowCardinality(String),
    level LowCardinality(String),
    status_message String,
    start_time DateTime64(6, 'UTC'),
    end_time DateTime64(6, 'UTC'),
    model LowCardinality(String),
    tool_name LowCardinality(String),
    input_tokens UInt32,
    output_tokens UInt32,
    cost_usd Float64,
    input String CODEC(ZSTD(3)),
    output String CODEC(ZSTD(3)),
    attributes Map(LowCardinality(String), String),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
  ) ENGINE = ReplacingMergeTree(ingested_at)
  ORDER BY (project_id, trace_id, id)`,
  // The trace index: one row per observation with its place in the tree (DFS pre/post order),
  // depth and the totals of its whole branch, so a collapsed branch can show its cost, time and
  // errors without loading what is inside it. It also carries what a tree row shows (name, kind,
  // times, cost, the start of the error), so opening and paging never read the raw observations,
  // whose inputs and outputs are most of their size. Rebuilt when new spans arrive; readers use the
  // latest version from trace_index_meta.
  `CREATE TABLE IF NOT EXISTS trace_nodes (
    project_id LowCardinality(String),
    trace_id String,
    version UInt64,
    id String,
    parent_id String,
    pre UInt32,
    post UInt32,
    depth UInt16,
    child_count UInt32,
    subtree_size UInt32,
    subtree_cost Float64,
    subtree_tokens UInt64,
    subtree_errors UInt32,
    subtree_start DateTime64(6, 'UTC'),
    subtree_end DateTime64(6, 'UTC'),
    critical UInt8,
    orphan UInt8,
    name String,
    type LowCardinality(String),
    level LowCardinality(String),
    model LowCardinality(String),
    tool_name LowCardinality(String),
    start_time DateTime64(6, 'UTC'),
    end_time DateTime64(6, 'UTC'),
    cost_usd Float64,
    tokens UInt64,
    status_message String
  ) ENGINE = MergeTree
  ORDER BY (project_id, trace_id, version, pre)`,
  `CREATE TABLE IF NOT EXISTS trace_index_meta (
    project_id LowCardinality(String),
    trace_id String,
    version UInt64,
    spans UInt32,
    roots UInt32,
    orphans UInt32,
    max_depth UInt16,
    total_cost Float64,
    total_tokens UInt64,
    errors UInt32,
    start_time DateTime64(6, 'UTC'),
    end_time DateTime64(6, 'UTC'),
    root_name String,
    last_ingested DateTime64(3, 'UTC'),
    build_ms UInt32,
    format UInt8 DEFAULT 1
  ) ENGINE = ReplacingMergeTree(version)
  ORDER BY (project_id, trace_id)`,
];

// Columns added after the first release; an index built before them is rebuilt on first read
// (see INDEX_FORMAT in index/store.ts).
const UPGRADES = [
  "ALTER TABLE trace_index_meta ADD COLUMN IF NOT EXISTS format UInt8 DEFAULT 1",
  ...["name String", "type LowCardinality(String)", "level LowCardinality(String)", "model LowCardinality(String)", "tool_name LowCardinality(String)",
      "start_time DateTime64(6, 'UTC')", "end_time DateTime64(6, 'UTC')", "cost_usd Float64", "tokens UInt64", "status_message String"]
    .map((c) => `ALTER TABLE trace_nodes ADD COLUMN IF NOT EXISTS ${c}`),
];

export async function migrate(): Promise<void> {
  for (const q of [...SCHEMA, ...UPGRADES]) await ch().command({ query: q });
}
