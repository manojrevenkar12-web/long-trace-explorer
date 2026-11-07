"use client";
import { useEffect, useRef } from "react";

/** Marks the moment the first tree rows are on screen, once per page; the browser benchmark reads it. */
export function useFirstRowsMark(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    requestAnimationFrame(() => {
      performance.mark("lte:first-rows");
      document.documentElement.dataset.firstRows = "1";
    });
  }, [ready]);
}
