"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import { useFirstRowsMark } from "@/src/shared/firstRows";
import { count, duration, toMs, usd } from "@/src/shared/format";
import { color, size, space } from "@/src/shared/theme";
import { ErrorState, TreeSkeleton } from "@/src/shared/ui/States";
import { AgentGraph } from "../agent-graph/AgentGraph";
import { SearchBox } from "../search/SearchBox";
import { Detail } from "../span-detail/Detail";
import { TreeView } from "../trace-tree/TreeView";
import { useTree } from "../trace-tree/useTree";

type Tab = "tree" | "graph";

export function TraceExplorer({ traceId }: { traceId: string }) {
  const t = useTree(traceId);
  const [tab, setTab] = useState<Tab>("tree");
  const m = t.summary?.meta;
  useFirstRowsMark(t.lines.length > 0);
  return (
    <main>
      <header style={{ padding: `${space[3]}px ${space[4]}px`, borderBottom: `1px solid ${color.line}`, display: "flex", flexWrap: "wrap", gap: space[4], alignItems: "center" }}>
        <Link href="/" style={{ color: color.muted, fontSize: size.sm, textDecoration: "none" }}>Traces</Link>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <h1 style={{ fontSize: size.lg, fontWeight: 600, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m ? m.root_name || traceId : "Opening trace…"}</h1>
          {m && (
            <p className="num" style={{ margin: 0, fontSize: size.sm, color: color.muted }}>
              {count(m.spans)} spans, {count(m.max_depth + 1)} levels deep, {duration(toMs(m.end_time) - toMs(m.start_time))}, {usd(m.total_cost)}
              {m.errors > 0 && <span style={{ color: color.error }}>, {count(m.errors)} failed</span>}
              {m.orphans > 0 && <span style={{ color: color.warning }}>, {count(m.orphans)} without their parent</span>}
            </p>
          )}
        </div>
        <SearchBox traceId={traceId} onPick={(h) => { setTab("tree"); void t.revealHit(h); }} />
        <nav role="tablist" style={{ display: "flex", gap: space[4] }}>
          {(["tree", "graph"] as Tab[]).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              style={{ position: "relative", background: "none", border: 0, padding: `${space[1]}px 0`, cursor: "pointer", color: tab === k ? color.text : color.muted, fontWeight: tab === k ? 600 : 400 }}>
              {k === "tree" ? "Tree and timeline" : "Agent steps"}
              {tab === k && <motion.span layoutId="tab" style={{ position: "absolute", left: 0, right: 0, bottom: -2, height: 2, background: color.focus }} />}
            </button>
          ))}
        </nav>
      </header>
      {t.error ? (
        <ErrorState title="This trace could not be opened" message={t.error} onRetry={t.reload} />
      ) : (
        <div className="explorer">
          <section style={{ minWidth: 0, minHeight: 360 }}>
            {!t.summary ? <TreeSkeleton /> : tab === "tree" ? (
              <TreeView lines={t.lines} selected={t.selected} reveal={t.reveal} traceStart={toMs(t.summary.meta.start_time)} traceEnd={toMs(t.summary.meta.end_time)}
                onSelect={t.select} onToggle={t.toggle} onMore={t.more} onEarlier={t.earlier} />
            ) : <AgentGraph traceId={traceId} />}
          </section>
          <aside className="detail" style={{ borderLeft: `1px solid ${color.line}`, overflow: "auto", background: color.panel }}>
            <Detail traceId={traceId} id={t.selected} />
          </aside>
        </div>
      )}
      {t.summary && (
        <footer className="num" style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: `4px ${space[4]}px`, fontSize: size.xs, color: color.faint, background: color.bg, borderTop: `1px solid ${color.line}` }}>
          Opened from the index{t.summary.rebuilt ? ` (rebuilt now in ${t.summary.meta.build_ms} ms)` : ""}; {count(t.lines.filter((l) => l.kind === "row").length)} of {count(t.summary.meta.spans)} spans loaded, the rest load when a branch is opened.
        </footer>
      )}
    </main>
  );
}
