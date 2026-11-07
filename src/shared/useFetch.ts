"use client";
import { useCallback, useEffect, useState } from "react";

export type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

export async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = ((await r.json()) as { message?: string }).message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export function useFetch<T>(url: string | null): Load<T> & { retry: () => void } {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [n, setN] = useState(0);
  const retry = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    setLoad({ state: "loading" });
    getJSON<T>(url, ctl.signal)
      .then((data) => setLoad({ state: "ready", data }))
      .catch((e: Error) => !ctl.signal.aborted && setLoad({ state: "error", message: e.message }));
    return () => ctl.abort();
  }, [url, n]);
  return { ...load, retry };
}
