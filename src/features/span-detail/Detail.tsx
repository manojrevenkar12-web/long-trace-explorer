"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment } from "react";
import { bytes, count, duration, toMs, usd } from "@/src/shared/format";
import { color, kindColor, size, space } from "@/src/shared/theme";
import { useFetch } from "@/src/shared/useFetch";
import { EmptyState, ErrorState } from "@/src/shared/ui/States";

interface Observation {
  id: string; name: string; type: string; level: string; status_message: string; start_time: string; end_time: string;
  model: string; tool_name: string; input_tokens: number; output_tokens: number; cost_usd: number;
  input: string; input_bytes: number; output: string; output_bytes: number; attributes: Record<string, string>;
}

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function Detail({ traceId, id }: { traceId: string; id: string | null }) {
  const d = useFetch<Observation>(id ? `/api/traces/${traceId}/observations/${id}` : null);
  if (!id) return <div style={{ padding: space[5] }}><EmptyState title="Nothing selected">Pick a span in the tree to see its input, output and cost.</EmptyState></div>;
  if (d.state === "loading") return <div style={{ padding: space[5], color: color.muted }} role="status">Loading the span…</div>;
  if (d.state === "error") return <ErrorState title="The span did not load" message={d.message} onRetry={d.retry} />;
  const o = d.data;
  const facts: [string, string][] = [
    ["Duration", duration(toMs(o.end_time) - toMs(o.start_time))],
    ["Started", o.start_time.replace("T", " ").slice(0, 23)],
  ];
  if (o.model) facts.push(["Model", o.model]);
  if (o.tool_name) facts.push(["Tool", o.tool_name]);
  if (o.input_tokens || o.output_tokens) facts.push(["Tokens", `${count(o.input_tokens)} in, ${count(o.output_tokens)} out`]);
  if (o.cost_usd) facts.push(["Cost", usd(o.cost_usd)]);
  return (
    <AnimatePresence mode="wait">
      <motion.div key={o.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} style={{ padding: space[4] }}>
        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: kindColor[o.type] ?? kindColor.SPAN }} />
          <span style={{ fontSize: size.xs, color: color.muted }}>{o.type.toLowerCase()}</span>
        </div>
        <h2 style={{ fontSize: size.lg, fontWeight: 600, margin: `${space[1]}px 0 ${space[3]}px`, overflowWrap: "anywhere" }}>{o.name}</h2>
        {o.level === "ERROR" && (
          <p style={{ margin: `0 0 ${space[3]}px`, padding: space[3], border: `1px solid ${color.error}`, borderRadius: 4, color: color.error, fontSize: size.sm }}>{o.status_message || "Failed without a message"}</p>
        )}
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: `${space[1]}px ${space[4]}px`, margin: 0, fontSize: size.sm }}>
          {facts.map(([k, v]) => (<Fragment key={k}><dt style={{ color: color.muted }}>{k}</dt><dd className="num" style={{ margin: 0 }}>{v}</dd></Fragment>))}
        </dl>
        <IO label="Input" text={o.input} total={o.input_bytes} />
        <IO label="Output" text={o.output} total={o.output_bytes} />
      </motion.div>
    </AnimatePresence>
  );
}

function IO({ label, text, total }: { label: string; text: string; total: number }) {
  return (
    <section style={{ marginTop: space[4] }}>
      <h3 style={{ fontSize: size.sm, fontWeight: 500, color: color.muted, margin: `0 0 ${space[1]}px` }}>
        {label}{total > text.length ? ` (first ${bytes(text.length)} of ${bytes(total)})` : ""}
      </h3>
      {text ? (
        <pre style={{ margin: 0, padding: space[3], background: color.panel, border: `1px solid ${color.line}`, borderRadius: 4, fontSize: size.sm, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 260, overflow: "auto", fontFamily: "inherit" }}>{pretty(text)}</pre>
      ) : <p style={{ margin: 0, color: color.faint, fontSize: size.sm }}>None recorded.</p>}
    </section>
  );
}
