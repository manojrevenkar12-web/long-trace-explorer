"use client";
import { count } from "@/src/shared/format";
import { color, layout, size, space } from "@/src/shared/theme";
import { useFetch } from "@/src/shared/useFetch";
import { ErrorState, TreeSkeleton } from "@/src/shared/ui/States";
import { BenchTable } from "./BenchTable";
import { OpenRace } from "./OpenRace";
import { TraceList } from "./TraceList";
import type { Results } from "./types";

export function Home() {
  const r = useFetch<Results>("/results.json");
  const dev = r.state === "ready" ? r.data.rows.filter((x) => x.set === "dev") : [];
  const held = r.state === "ready" ? r.data.rows.filter((x) => x.set === "heldout") : [];
  const largest = dev.at(-1);
  return (
    <main style={{ maxWidth: layout.maxWidth, margin: "0 auto", padding: `${space[7]}px ${space[4]}px` }}>
      <div className="home-grid">
        <section>
          <h1 style={{ fontSize: size.xxl, lineHeight: 1.05, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Long trace explorer</h1>
          <p style={{ fontSize: size.md, color: color.muted, maxWidth: 520, margin: `${space[3]}px 0 ${space[6]}px` }}>
            Opens an agent trace with hundreds of thousands of spans by sending only what fits on the screen: a summary, the slowest path,
            and the next page of children when you open a branch.
          </p>
          <h2 style={{ fontSize: size.base, fontWeight: 600, margin: `0 0 ${space[3]}px` }}>Traces</h2>
          <TraceList />
        </section>
        <section>
          {r.state === "loading" && <TreeSkeleton rows={4} />}
          {r.state === "error" && <ErrorState title="No benchmark results" message="Run npm run bench, then npm run report, to write public/results.json." onRetry={r.retry} />}
          {largest && (
            <>
              <h2 style={{ fontSize: size.lg, fontWeight: 600, margin: `0 0 ${space[4]}px` }}>Opening a {count(largest.spans)} span trace</h2>
              <OpenRace row={largest} />
            </>
          )}
        </section>
      </div>
      {r.state === "ready" && (
        <section style={{ marginTop: space[7] }}>
          <BenchTable rows={dev} caption="Development traces, one shape, growing size. Times are p50 / p95 on the server; browser times include rendering." />
          <div style={{ height: space[6] }} />
          <BenchTable rows={held} caption={`Held-out shapes, pinned by hash before the first run (${r.data.pinned.heldout_sha256.slice(0, 12)}) and run once.`} />
          <p className="num" style={{ fontSize: size.xs, color: color.faint, marginTop: space[4] }}>
            Generated {r.data.generated_at} at commit {r.data.commit} on {r.data.machine}, ClickHouse {r.data.clickhouse}. The first open after new spans arrive
            includes building the index; every later open reads it.
          </p>
        </section>
      )}
    </main>
  );
}
