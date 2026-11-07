"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { color, kindColor, size, space } from "@/src/shared/theme";
import { getJSON } from "@/src/shared/useFetch";
import type { Hit } from "../trace-tree/types";

type Result = { state: "idle" } | { state: "loading" } | { state: "error"; message: string } | { state: "done"; hits: Hit[]; truncated: boolean };

/** Search names, tools, models, errors, inputs and outputs of every span, including ones not loaded. */
export function SearchBox({ traceId, onPick }: { traceId: string; onPick: (h: Hit) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Result>({ state: "idle" });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setRes({ state: "idle" });
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setRes({ state: "loading" });
      getJSON<{ hits: Hit[]; truncated: boolean }>(`/api/traces/${traceId}/search?q=${encodeURIComponent(term)}`, ctl.signal)
        .then((r) => setRes({ state: "done", ...r }))
        .catch((e: Error) => !ctl.signal.aborted && setRes({ state: "error", message: e.message }));
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, traceId]);
  return (
    <div style={{ position: "relative", width: "min(420px, 100%)" }}>
      <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search every span: error text, tool, model, input…" aria-label="Search this trace"
        style={{ width: "100%", padding: "7px 10px", background: color.panel, border: `1px solid ${color.line}`, borderRadius: 4, color: color.text, fontSize: size.base }} />
      <AnimatePresence>
        {open && res.state !== "idle" && (
          <motion.div role="listbox" aria-label="Matching spans" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            style={{ position: "absolute", zIndex: 20, top: "calc(100% + 4px)", left: 0, right: 0, background: color.raised, border: `1px solid ${color.line}`, borderRadius: 6, maxHeight: 360, overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.35)" }}>
            {res.state === "loading" && <p style={{ margin: 0, padding: space[3], color: color.muted, fontSize: size.sm }}>Searching…</p>}
            {res.state === "error" && <p style={{ margin: 0, padding: space[3], color: color.error, fontSize: size.sm }}>{res.message}</p>}
            {res.state === "done" && res.hits.length === 0 && <p style={{ margin: 0, padding: space[3], color: color.muted, fontSize: size.sm }}>No span mentions “{q.trim()}”.</p>}
            {res.state === "done" && res.hits.map((h) => (
              <button key={h.id} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(h); setOpen(false); }}
                style={{ display: "flex", width: "100%", gap: space[2], alignItems: "center", textAlign: "left", padding: `${space[2]}px ${space[3]}px`, background: "none", border: 0, borderBottom: `1px solid ${color.line}`, cursor: "pointer" }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: kindColor[h.type] ?? kindColor.SPAN, flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: h.level === "ERROR" ? color.error : color.text }}>{h.name}</span>
                <span style={{ fontSize: size.xs, color: color.muted }}>in {h.field}, depth {h.ancestors.length}</span>
              </button>
            ))}
            {res.state === "done" && res.truncated && <p style={{ margin: 0, padding: space[3], color: color.muted, fontSize: size.xs }}>Showing the first {res.hits.length}; refine the search to see others.</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
