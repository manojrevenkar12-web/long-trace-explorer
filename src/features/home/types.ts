export interface TraceItem { trace_id: string; spans: string; first: string; last: string; cost: number; errors: string; root_name: string }

export interface BenchRow {
  set: "dev" | "heldout";
  shape: string;
  spans: number;
  ingest_spans_per_s: number;
  index_build_ms: number;
  cold_open_ms: number;
  trace_id: string;
  open_ms: { p50: number; p95: number };
  open_bytes: number;
  expand_ms: { p50: number; p95: number };
  search_ms: { p50: number; p95: number };
  graph_ms: { p50: number; p95: number };
  full_ms: { p50: number; p95: number } | null;
  full_bytes: number | null;
  full_io_ms: { p50: number; p95: number } | null;
  full_io_bytes: number | null;
  browser?: { windowed_first_rows_ms: number; windowed_heap_mb: number; full_first_rows_ms: number | null; full_heap_mb: number | null; full_failed?: string };
  correct: { every_span_once: boolean; totals_match: boolean; search_reveals: boolean };
}

export interface Results {
  generated_at: string;
  machine: string;
  clickhouse: string;
  commit: string;
  pinned: { heldout_sha256: string; pinned_at: string };
  rows: BenchRow[];
}
