"use client";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { count, duration, toMs, usd } from "@/src/shared/format";
import { color, kindColor, layout, size, space } from "@/src/shared/theme";
import type { Line } from "./useTree";
import type { Row } from "./types";

interface Props {
  lines: Line[];
  selected: string | null;
  reveal: string | null;
  traceStart: number;
  traceEnd: number;
  onSelect: (id: string) => void;
  onToggle: (row: Row, open?: boolean) => void;
  onMore: (parent: string) => void;
  onEarlier: (parent: string) => void;
}

const OVERSCAN = 12;

/** A virtualised tree with a timeline column: only the rows on screen exist in the DOM. */
export function TreeView({ lines, selected, reveal, traceStart, traceEnd, onSelect, onToggle, onMore, onEarlier }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const index = useMemo(() => lines.findIndex((l) => l.kind === "row" && l.row.id === selected), [lines, selected]);
  // Scroll a revealed row (a search hit, or the slow path on open) into view once, as soon as its
  // page has loaded; later changes to the tree must not pull the view back.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !reveal || revealed.current === reveal) return;
    const id = reveal.split("#")[0];
    const i = lines.findIndex((l) => l.kind === "row" && l.row.id === id);
    if (i < 0) return;
    revealed.current = reveal;
    if (i * layout.rowHeight < el.scrollTop || (i + 1) * layout.rowHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, i * layout.rowHeight - el.clientHeight / 3);
    }
  }, [reveal, lines]);
  const first = Math.max(0, Math.floor(top / layout.rowHeight) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((top + height) / layout.rowHeight) + OVERSCAN);
  // Each bar is drawn inside its parent's time window, so a 90 ms tool call inside a 2 hour agent is
  // still visible in a 7 day trace. Top-level rows use the whole trace.
  const windows = useMemo(() => {
    const w = new Map<string, [number, number]>();
    for (const l of lines) if (l.kind === "row" && l.row.child_count) w.set(l.row.id, [toMs(l.row.subtree_start), toMs(l.row.subtree_end)]);
    return w;
  }, [lines]);
  const place = (r: Row) => {
    const [a, b] = (!r.orphan && windows.get(r.parent_id)) || [traceStart, traceEnd];
    const len = Math.max(1, b - a);
    return { start: (toMs(r.start_time) - a) / len, width: (toMs(r.end_time) - toMs(r.start_time)) / len };
  };

  const onKey = (e: React.KeyboardEvent) => {
    const cur = lines[index];
    const go = (j: number) => {
      for (let k = j; k >= 0 && k < lines.length; k += j > index ? 1 : -1) {
        const l = lines[k];
        if (l.kind === "row") return onSelect(l.row.id);
      }
    };
    if (e.key === "ArrowDown") { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(index - 1); }
    else if (e.key === "ArrowRight" && cur?.kind === "row") { e.preventDefault(); onToggle(cur.row, true); }
    else if (e.key === "ArrowLeft" && cur?.kind === "row") { e.preventDefault(); onToggle(cur.row, false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 38%", fontSize: size.xs, color: color.faint, borderBottom: `1px solid ${color.line}`, minWidth: 640 }}>
      <span style={{ padding: `${space[1]}px ${space[3]}px` }}>Step</span>
      <span style={{ padding: `${space[1]}px ${space[2]}px`, borderLeft: `1px solid ${color.line}` }}>When, within the step above it</span>
    </div>
    <div ref={box} role="tree" aria-label="Spans of this trace" tabIndex={0} onKeyDown={onKey}
      onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}
      style={{ overflow: "auto", flex: 1, minHeight: 0, position: "relative", outline: "none" }}>
      <div style={{ height: lines.length * layout.rowHeight, position: "relative", minWidth: 640 }}>
        {lines.slice(first, last).map((l, k) => {
          const i = first + k;
          const style: React.CSSProperties = { position: "absolute", top: i * layout.rowHeight, left: 0, right: 0, height: layout.rowHeight };
          if (l.kind !== "row") {
            const label = l.kind === "loading" ? "Loading…" : l.kind === "more" ? `Show ${count(Math.min(l.left, 200))} more of ${count(l.left)}` : l.kind === "earlier" ? "Show earlier spans" : `Could not load: ${l.message}`;
            const act = l.kind === "more" ? () => onMore(l.parent) : l.kind === "earlier" ? () => onEarlier(l.parent) : undefined;
            return (
              <div key={`${l.kind}-${l.parent}-${i}`} style={{ ...style, paddingLeft: space[3] + l.depth * layout.indent + 18, display: "flex", alignItems: "center", fontSize: size.sm, color: l.kind === "failed" ? color.error : color.muted }}>
                {act ? <button onClick={act} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: color.focus, fontSize: size.sm }}>{label}</button> : label}
              </div>
            );
          }
          return <TreeRow key={l.row.id} row={l.row} open={l.open} style={style} selected={l.row.id === selected}
            {...place(l.row)} onSelect={onSelect} onToggle={onToggle} />;
        })}
      </div>
    </div>
    </div>
  );
}

function TreeRow({ row, open, style, selected, start, width, onSelect, onToggle }: {
  row: Row; open: boolean; style: React.CSSProperties; selected: boolean; start: number; width: number;
  onSelect: (id: string) => void; onToggle: (row: Row, open?: boolean) => void;
}) {
  const kc = kindColor[row.type] ?? kindColor.SPAN;
  const err = row.level === "ERROR";
  const ms = toMs(row.end_time) - toMs(row.start_time);
  const label = row.type === "TOOL" && row.tool_name ? row.tool_name : row.type === "GENERATION" && row.model ? `${row.name} (${row.model})` : row.name;
  return (
    <div role="treeitem" aria-selected={selected} aria-expanded={row.child_count ? open : undefined} aria-level={row.depth + 1}
      onClick={() => onSelect(row.id)} onDoubleClick={() => row.child_count && onToggle(row)}
      style={{ ...style, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 38%", alignItems: "center", cursor: "default",
        background: selected ? color.select : "transparent", borderLeft: `2px solid ${selected ? color.focus : "transparent"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, paddingLeft: space[2] + row.depth * layout.indent }}>
        {row.child_count ? (
          <button aria-label={open ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); onToggle(row); }}
            style={{ width: 16, height: 16, padding: 0, border: 0, background: "none", cursor: "pointer", color: color.muted, flex: "none" }}>
            <motion.svg width="10" height="10" viewBox="0 0 10 10" animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}>
              <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </motion.svg>
          </button>
        ) : <span style={{ width: 16, flex: "none" }} />}
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: row.type === "AGENT" ? 1 : 4, background: kc, flex: "none", transform: row.type === "AGENT" ? "rotate(45deg)" : undefined }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: err ? color.error : color.text, fontSize: size.base }}>
          {label}
        </span>
        {row.orphan ? <span title="This span's parent was never received" style={{ fontSize: size.xs, color: color.warning, flex: "none" }}>parent missing</span> : null}
        {row.child_count > 0 && !open && (
          <span className="num" style={{ fontSize: size.xs, color: color.faint, whiteSpace: "nowrap", flex: "none" }}>
            {count(row.subtree_size - 1)} inside{row.subtree_cost > 0 ? `, ${usd(row.subtree_cost)}` : ""}
            {row.subtree_errors > 0 && <span style={{ color: color.error }}>, {count(row.subtree_errors)} failed</span>}
          </span>
        )}
      </div>
      <div style={{ position: "relative", height: "100%", borderLeft: `1px solid ${color.line}` }}>
        <div style={{ position: "absolute", top: 9, height: 10, left: `${Math.min(99.6, Math.max(0, start) * 100)}%`, width: `max(2px, ${Math.min(100, width * 100)}%)`,
          background: err ? color.error : kc, opacity: row.critical ? 1 : 0.7, borderRadius: 2 }} />
        <span className="num" style={{ position: "absolute", right: space[2], top: 5, fontSize: size.xs, color: color.muted, background: selected ? color.select : color.bg, paddingLeft: 4 }}>{duration(ms)}</span>
      </div>
    </div>
  );
}
