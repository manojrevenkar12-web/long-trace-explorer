"use client";
import { motion, useReducedMotion } from "framer-motion";
import { bytes, count, duration } from "@/src/shared/format";
import { color, size, space } from "@/src/shared/theme";
import type { BenchRow } from "./types";

/** The one moving thing on the page: how long each approach takes to open the largest trace, drawn to scale. */
export function OpenRace({ row }: { row: BenchRow }) {
  const reduce = useReducedMotion();
  const b = row.browser;
  // Prefer what a person feels (first rows in the browser); fall back to server time.
  const lanes = [
    { label: "This explorer", ms: b ? b.windowed_first_rows_ms : row.open_ms.p50, sent: row.open_bytes, heap: b?.windowed_heap_mb ?? null, tone: color.focus, failed: undefined as string | undefined },
    { label: "Download every span, build the tree in the browser", ms: b ? b.full_first_rows_ms : row.full_ms?.p50 ?? null, sent: row.full_bytes, heap: b?.full_heap_mb ?? null, tone: color.muted, failed: b?.full_failed ?? "did not finish" },
  ];
  const scale = Math.max(...lanes.map((l) => l.ms ?? 0));
  return (
    <figure style={{ margin: 0 }} aria-label={`Opening a ${count(row.spans)} span trace`}>
      {lanes.map((l, i) => (
        <div key={l.label} style={{ marginBottom: space[5] }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: space[3], marginBottom: space[1] }}>
            <span style={{ fontSize: size.sm, color: i === 0 ? color.text : color.muted }}>{l.label}</span>
            <span className="num" style={{ fontSize: i === 0 ? size.xl : size.lg, fontWeight: 600, color: i === 0 ? color.focus : color.text }}>{l.ms === null ? l.failed : duration(l.ms)}</span>
          </div>
          <div style={{ height: 14, background: color.panel, borderRadius: 2, overflow: "hidden" }}>
            {l.ms !== null && (
              <motion.div
                initial={{ width: reduce ? `${(l.ms / scale) * 100}%` : 0 }}
                animate={{ width: `${Math.max(0.6, (l.ms / scale) * 100)}%` }}
                // Both bars grow at the same speed, so the short one stops almost at once: the difference is the point.
                transition={{ duration: reduce ? 0 : 2 * (l.ms / scale), ease: "linear", delay: 0.25 }}
                style={{ height: "100%", background: l.tone }}
              />
            )}
          </div>
          <div className="num" style={{ fontSize: size.xs, color: color.faint, marginTop: space[1] }}>
            {bytes(l.sent ?? 0)} sent{l.heap !== null ? `, ${l.heap} MB of JavaScript heap` : ""}
          </div>
        </div>
      ))}
      <figcaption style={{ fontSize: size.xs, color: color.faint, maxWidth: 520 }}>
        {b ? "From navigation to the first tree rows on screen in headless Chromium, median of three cold loads." : "Server time, median of repeated requests."} Local
        ClickHouse, production build. Bars drawn to scale.
      </figcaption>
    </figure>
  );
}
