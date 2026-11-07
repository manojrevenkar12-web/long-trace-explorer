"use client";
// The comparison point for the benchmark, not a feature: a trace view that downloads every span,
// builds the tree in the browser and then shows it (virtualised, so the cost measured is the
// download, parsing and tree building, not the DOM).
import { useEffect, useMemo, useRef, useState } from "react";
import { count, duration, toMs } from "@/src/shared/format";
import { useFirstRowsMark } from "@/src/shared/firstRows";
import { color, kindColor, layout, size, space } from "@/src/shared/theme";
import { useFetch } from "@/src/shared/useFetch";
import { ErrorState, TreeSkeleton } from "@/src/shared/ui/States";

interface Obs { id: string; parent_id: string; name: string; type: string; level: string; start_time: string; end_time: string }
interface Line { o: Obs; depth: number }

function flatten(obs: Obs[]): Line[] {
  const ids = new Set(obs.map((o) => o.id));
  const kids = new Map<string, Obs[]>();
  for (const o of obs) {
    const p = o.parent_id && ids.has(o.parent_id) ? o.parent_id : "";
    const list = kids.get(p);
    if (list) list.push(o); else kids.set(p, [o]);
  }
  const out: Line[] = [];
  const seen = new Set<string>();
  const stack: Line[] = (kids.get("") ?? []).slice().reverse().map((o) => ({ o, depth: 0 }));
  while (stack.length) {
    const l = stack.pop()!;
    if (seen.has(l.o.id)) continue;
    seen.add(l.o.id);
    out.push(l);
    const c = kids.get(l.o.id);
    if (c) for (let i = c.length - 1; i >= 0; i--) stack.push({ o: c[i], depth: l.depth + 1 });
  }
  return out;
}

export function FullTrace({ traceId }: { traceId: string }) {
  const f = useFetch<{ observations: Obs[] }>(`/api/traces/${traceId}/full`);
  const lines = useMemo(() => (f.state === "ready" ? flatten(f.data.observations) : []), [f]);
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(800);
  useEffect(() => { if (ref.current) setHeight(ref.current.clientHeight); }, [lines.length]);
  useFirstRowsMark(lines.length > 0);
  if (f.state === "loading") return <TreeSkeleton />;
  if (f.state === "error") return <ErrorState title="The full trace did not load" message={f.message} onRetry={f.retry} />;
  const h = layout.rowHeight;
  const first = Math.max(0, Math.floor(top / h) - 12);
  const last = Math.min(lines.length, Math.ceil((top + height) / h) + 12);
  return (
    <main>
      <p style={{ padding: `${space[2]}px ${space[4]}px`, margin: 0, color: color.muted, fontSize: size.sm }}>
        Benchmark baseline: all {count(lines.length)} spans downloaded and laid out in the browser.
      </p>
      <div ref={ref} onScroll={(e) => setTop(e.currentTarget.scrollTop)} style={{ height: "calc(100vh - 40px)", overflow: "auto", position: "relative" }}>
        <div style={{ height: lines.length * h, position: "relative" }}>
          {lines.slice(first, last).map((l, i) => (
            <div key={l.o.id} style={{ position: "absolute", top: (first + i) * h, height: h, left: 0, right: 0, display: "flex", alignItems: "center", gap: space[2], paddingLeft: space[3] + l.depth * layout.indent, fontSize: size.sm }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: kindColor[l.o.type] ?? color.muted }} />
              <span style={{ color: l.o.level === "ERROR" ? color.error : color.text }}>{l.o.name}</span>
              <span className="num" style={{ marginLeft: "auto", paddingRight: space[3], color: color.muted }}>{duration(toMs(l.o.end_time) - toMs(l.o.start_time))}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
