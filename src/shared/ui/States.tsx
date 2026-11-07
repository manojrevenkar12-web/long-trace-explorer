"use client";
import { motion } from "framer-motion";
import { color, layout, radius, size, space } from "../theme";

/** Rows shaped like the tree: indented bars that pulse while the trace loads. */
export function TreeSkeleton({ rows = 14 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading the trace" style={{ padding: space[3] }}>
      {Array.from({ length: rows }, (_, i) => (
        <motion.div key={i} animate={{ opacity: [0.35, 0.8, 0.35] }} transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.05 }}
          style={{ height: 10, margin: `${(layout.rowHeight - 10) / 2}px 0`, marginLeft: (i % 5) * layout.indent, width: `${40 + ((i * 37) % 45)}%`, background: color.line, borderRadius: radius.s }} />
      ))}
    </div>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ padding: space[5], color: color.text }}>
      <p style={{ margin: 0, fontWeight: 600 }}>{title}</p>
      <p style={{ margin: `${space[1]}px 0 ${space[3]}px`, color: color.muted, fontSize: size.sm }}>{message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: space[5], color: color.muted, fontSize: size.sm, border: `1px dashed ${color.line}`, borderRadius: radius.m }}>
      <p style={{ margin: `0 0 ${space[1]}px`, color: color.text, fontWeight: 600 }}>{title}</p>
      {children}
    </div>
  );
}
