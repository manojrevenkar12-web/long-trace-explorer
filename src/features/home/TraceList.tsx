"use client";
import Link from "next/link";
import { count, duration, toMs, usd } from "@/src/shared/format";
import { color, size, space } from "@/src/shared/theme";
import { useFetch } from "@/src/shared/useFetch";
import { EmptyState, ErrorState, TreeSkeleton } from "@/src/shared/ui/States";
import type { TraceItem } from "./types";

export function TraceList() {
  const t = useFetch<{ traces: TraceItem[] }>("/api/traces");
  if (t.state === "loading") return <TreeSkeleton rows={6} />;
  if (t.state === "error") return <ErrorState title="Traces did not load" message={t.message} onRetry={t.retry} />;
  if (!t.data.traces.length)
    return (
      <EmptyState title="No traces yet">
        Send spans to <code>/api/public/otel/v1/traces</code> with any OpenTelemetry exporter, or run <code>npm run generate</code> for sample agent traces.
      </EmptyState>
    );
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {t.data.traces.map((x) => (
        <li key={x.trace_id} style={{ borderBottom: `1px solid ${color.line}` }}>
          <Link href={`/traces/${x.trace_id}`} style={{ display: "block", padding: `${space[3]}px 0`, textDecoration: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: space[3] }}>
              <span style={{ fontWeight: 500 }}>{x.root_name || "Unnamed trace"}</span>
              <span className="num" style={{ color: color.muted }}>{count(Number(x.spans))} spans</span>
            </div>
            <div className="num" style={{ fontSize: size.sm, color: color.faint }}>
              {duration(toMs(x.last) - toMs(x.first))}, {usd(x.cost)}
              {Number(x.errors) > 0 && <span style={{ color: color.error }}>, {count(Number(x.errors))} failed</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
