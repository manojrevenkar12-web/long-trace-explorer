"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { getJSON } from "@/src/shared/useFetch";
import type { Hit, Page, Row, Summary } from "./types";

/** Loaded children of one parent ("" is the top level). `earlier` means rows before the first one exist but are not loaded. */
interface Branch {
  rows: Row[];
  next: number | null;
  total: number;
  earlier: boolean;
  loading: boolean;
  error?: string;
}

interface State {
  summary: Summary | null;
  error: string | null;
  branches: Map<string, Branch>;
  expanded: Set<string>;
  selected: string | null;
  reveal: string | null; // a span to scroll to
}

type Action =
  | { t: "summary"; s: Summary }
  | { t: "error"; message: string }
  | { t: "loading"; parent: string }
  | { t: "page"; parent: string; page: Page; mode: "replace" | "append" | "from"; parentPre?: number }
  | { t: "pageError"; parent: string; message: string }
  | { t: "toggle"; id: string; open?: boolean }
  | { t: "select"; id: string | null; reveal?: string };

function reduce(s: State, a: Action): State {
  switch (a.t) {
    case "summary": {
      const branches = new Map<string, Branch>();
      for (const p of a.s.pages) branches.set(p.parent, { rows: p.rows, next: p.next, total: p.total, earlier: false, loading: false });
      // Land on the deepest opened step of the slowest path, scrolled into view: that is where the time went.
      const focus = a.s.expanded[a.s.expanded.length - 1] ?? null;
      return { ...s, summary: a.s, error: null, branches, expanded: new Set(a.s.expanded), selected: focus, reveal: focus };
    }
    case "error":
      return { ...s, error: a.message };
    case "loading": {
      const b = new Map(s.branches);
      const cur = b.get(a.parent);
      b.set(a.parent, { rows: cur?.rows ?? [], next: cur?.next ?? null, total: cur?.total ?? 0, earlier: cur?.earlier ?? false, loading: true });
      return { ...s, branches: b };
    }
    case "page": {
      const b = new Map(s.branches);
      const cur = b.get(a.parent);
      const rows = a.mode === "append" && cur ? [...cur.rows, ...a.page.rows] : a.page.rows;
      b.set(a.parent, { rows, next: a.page.next, total: a.page.total, earlier: a.mode === "from" ? rows.length > 0 && rows[0].pre !== (a.parentPre ?? -1) + 1 : a.mode === "append" ? cur?.earlier ?? false : false, loading: false });
      return { ...s, branches: b };
    }
    case "pageError": {
      const b = new Map(s.branches);
      const cur = b.get(a.parent);
      b.set(a.parent, { rows: cur?.rows ?? [], next: cur?.next ?? null, total: cur?.total ?? 0, earlier: cur?.earlier ?? false, loading: false, error: a.message });
      return { ...s, branches: b };
    }
    case "toggle": {
      const e = new Set(s.expanded);
      const open = a.open ?? !e.has(a.id);
      if (open) e.add(a.id);
      else e.delete(a.id);
      return { ...s, expanded: e };
    }
    case "select":
      return { ...s, selected: a.id, reveal: a.reveal ?? s.reveal };
  }
}

export type Line =
  | { kind: "row"; row: Row; open: boolean }
  | { kind: "loading"; parent: string; depth: number }
  | { kind: "more"; parent: string; depth: number; left: number }
  | { kind: "earlier"; parent: string; depth: number }
  | { kind: "failed"; parent: string; depth: number; message: string };

export function useTree(traceId: string) {
  const [s, dispatch] = useReducer(reduce, { summary: null, error: null, branches: new Map<string, Branch>(), expanded: new Set<string>(), selected: null, reveal: null });
  const base = `/api/traces/${traceId}`;
  const stateRef = useRef(s);
  stateRef.current = s;

  const loadSummary = useCallback(() => {
    dispatch({ t: "error", message: "" });
    getJSON<Summary>(`${base}/summary`).then((x) => dispatch({ t: "summary", s: x })).catch((e: Error) => dispatch({ t: "error", message: e.message }));
  }, [base]);

  useEffect(loadSummary, [loadSummary]);

  const fetchPage = useCallback(
    async (parent: string, mode: "replace" | "append" | "from", after: number | null, parentPre?: number) => {
      dispatch({ t: "loading", parent });
      const q = new URLSearchParams();
      if (parent) q.set("parent", parent);
      if (after !== null) q.set("after", String(after));
      try {
        const page = await getJSON<Page>(`${base}/children?${q}`);
        dispatch({ t: "page", parent, page, mode, parentPre });
      } catch (e) {
        dispatch({ t: "pageError", parent, message: (e as Error).message });
      }
    },
    [base],
  );

  const toggle = useCallback(
    (row: Row, open?: boolean) => {
      const willOpen = open ?? !stateRef.current.expanded.has(row.id);
      dispatch({ t: "toggle", id: row.id, open: willOpen });
      if (willOpen && row.child_count > 0 && !stateRef.current.branches.has(row.id)) void fetchPage(row.id, "replace", null);
    },
    [fetchPage],
  );

  const more = useCallback((parent: string) => {
    const b = stateRef.current.branches.get(parent);
    if (b?.next != null && !b.loading) void fetchPage(parent, "append", b.next);
  }, [fetchPage]);

  const earlier = useCallback((parent: string) => void fetchPage(parent, "replace", null), [fetchPage]);

  /** Opens the branch down to a search hit, loading only what is missing, then selects it. */
  const revealHit = useCallback(
    async (hit: Hit) => {
      const chain = [{ id: "", pre: -1 }, ...hit.ancestors];
      for (let i = 0; i < chain.length; i++) {
        const parent = chain[i].id;
        const child = chain[i + 1] ?? { id: hit.id, pre: hit.pre };
        const b = stateRef.current.branches.get(parent);
        if (!b || !b.rows.some((r) => r.id === child.id)) {
          await fetchPage(parent, "from", child.pre - 1, chain[i].pre);
        }
        if (parent) dispatch({ t: "toggle", id: parent, open: true });
      }
      // A fresh token each time, so picking the same hit again scrolls to it again.
      dispatch({ t: "select", id: hit.id, reveal: `${hit.id}#${Date.now()}` });
    },
    [fetchPage],
  );

  const lines = useMemo(() => {
    const out: Line[] = [];
    const walk = (parent: string, depth: number) => {
      const b = s.branches.get(parent);
      if (!b) return;
      if (b.earlier) out.push({ kind: "earlier", parent, depth });
      for (const row of b.rows) {
        const open = s.expanded.has(row.id) && row.child_count > 0;
        out.push({ kind: "row", row, open });
        if (open) {
          if (s.branches.get(row.id)?.rows.length) walk(row.id, depth + 1);
          else if (s.branches.get(row.id)?.error) out.push({ kind: "failed", parent: row.id, depth: depth + 1, message: s.branches.get(row.id)!.error! });
          else out.push({ kind: "loading", parent: row.id, depth: depth + 1 });
        }
      }
      if (b.loading && b.rows.length) out.push({ kind: "loading", parent, depth });
      else if (b.next !== null) out.push({ kind: "more", parent, depth, left: Math.max(0, b.total - b.rows.length) });
    };
    walk("", 0);
    return out;
  }, [s.branches, s.expanded]);

  return { ...s, lines, toggle, more, earlier, revealHit, reload: loadSummary, select: (id: string | null) => dispatch({ t: "select", id }) };
}
