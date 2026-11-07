"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { count, duration, usd } from "@/src/shared/format";
import { color, kindColor, size, space } from "@/src/shared/theme";
import { useFetch } from "@/src/shared/useFetch";
import { EmptyState, ErrorState, TreeSkeleton } from "@/src/shared/ui/States";

interface Graph {
  nodes: { label: string; calls: number; errors: number; p50_ms: number; p95_ms: number; cost: number }[];
  edges: { from: string; to: string; n: number }[];
}

const kindOf = (label: string) => (label.startsWith("tool") ? "TOOL" : label.startsWith("llm") ? "GENERATION" : label.startsWith("agent") ? "AGENT" : "SPAN");

/** What the agent did, aggregated over the whole trace: each kind of step, and which step follows which. */
export function AgentGraph({ traceId }: { traceId: string }) {
  const g = useFetch<Graph>(`/api/traces/${traceId}/graph`);
  const [focus, setFocus] = useState<string | null>(null);
  if (g.state === "loading") return <TreeSkeleton rows={8} />;
  if (g.state === "error") return <ErrorState title="The agent graph did not load" message={g.message} onRetry={g.retry} />;
  const { nodes, edges } = g.data;
  if (!nodes.length) return <div style={{ padding: space[5] }}><EmptyState title="No agent steps">This trace has no spans marked as agents, so there are no steps to connect.</EmptyState></div>;
  const top = nodes.slice(0, 12).map((n) => n.label);
  const labels = ["start", ...top];
  const cell = new Map(edges.map((e) => [`${e.from}→${e.to}`, e.n]));
  const max = Math.max(1, ...edges.filter((e) => labels.includes(e.from) && top.includes(e.to)).map((e) => e.n));
  const maxCalls = Math.max(...nodes.map((n) => n.calls));
  return (
    <div style={{ padding: space[4], overflow: "auto", height: "100%" }}>
      <h2 style={{ fontSize: size.md, fontWeight: 600, margin: `0 0 ${space[1]}px` }}>Steps</h2>
      <p style={{ margin: `0 0 ${space[3]}px`, color: color.muted, fontSize: size.sm }}>Every direct step of every agent span in this trace, grouped by tool, model or sub-agent.</p>
      <table>
        <thead><tr><th>Step</th><th>Calls</th><th className="r">Failed</th><th className="r">p50</th><th className="r">p95</th><th className="r">Cost</th></tr></thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.label} onMouseEnter={() => setFocus(n.label)} onMouseLeave={() => setFocus(null)} style={{ background: focus === n.label ? color.select : undefined }}>
              <td><span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: kindColor[kindOf(n.label)], marginRight: 8 }} />{n.label}</td>
              <td style={{ minWidth: 140 }}>
                <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${(n.calls / maxCalls) * 90}px` }} transition={{ duration: 0.4 }} style={{ height: 6, background: kindColor[kindOf(n.label)], borderRadius: 2 }} />
                  <span className="num">{count(n.calls)}</span>
                </div>
              </td>
              <td className="r" style={{ color: n.errors ? color.error : color.muted }}>{n.errors ? `${count(n.errors)} (${((n.errors / n.calls) * 100).toFixed(1)}%)` : "0"}</td>
              <td className="r">{duration(n.p50_ms)}</td>
              <td className="r">{duration(n.p95_ms)}</td>
              <td className="r">{usd(n.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ fontSize: size.md, fontWeight: 600, margin: `${space[6]}px 0 ${space[1]}px` }}>What follows what</h2>
      <p style={{ margin: `0 0 ${space[3]}px`, color: color.muted, fontSize: size.sm }}>Rows are the step before, columns the step after, within the same agent. Darker means more often.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "auto" }}>
          <thead>
            <tr><th></th>{top.map((t) => <th key={t} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 130, fontSize: size.xs, color: focus === t ? color.text : color.muted }}>{t}</th>)}</tr>
          </thead>
          <tbody>
            {labels.map((f) => (
              <tr key={f}>
                <td style={{ fontSize: size.xs, whiteSpace: "nowrap", color: focus === f ? color.text : color.muted }}>{f === "start" ? "agent starts" : f}</td>
                {top.map((t) => {
                  const n = cell.get(`${f}→${t}`) ?? 0;
                  return (
                    <td key={t} title={`${f} → ${t}: ${count(n)}`} style={{ padding: 0, border: `1px solid ${color.bg}` }}>
                      <div style={{ width: 26, height: 22, background: n ? color.focus : "transparent", opacity: n ? 0.15 + 0.85 * Math.sqrt(n / max) : 1 }} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
