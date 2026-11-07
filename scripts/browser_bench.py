"""Browser benchmark: open each benchmarked trace in Chromium twice, in the explorer and in the
full-load baseline page, and record the time until the first tree rows are on screen and the
JavaScript heap at that moment. Reads reports/bench-<set>.json, writes reports/browser-<set>.json.

    python3 scripts/browser_bench.py dev
"""
import json
import os
import sys
import time

from playwright.sync_api import TimeoutError as PwTimeout
from playwright.sync_api import sync_playwright

BASE = os.environ.get("EXPLORER_URL", "http://127.0.0.1:3000")
TIMEOUT_MS = int(os.environ.get("BROWSER_TIMEOUT_MS", "120000"))
REPEATS = int(os.environ.get("BROWSER_REPEATS", "3"))


def measure(browser, url):
    """Fresh context per load, so nothing is cached between runs."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    try:
        t0 = time.perf_counter()
        page.goto(url, wait_until="commit", timeout=TIMEOUT_MS)
        page.wait_for_function("document.documentElement && document.documentElement.dataset.firstRows === '1'", timeout=TIMEOUT_MS)
        wall = (time.perf_counter() - t0) * 1000
        mark = page.evaluate("performance.getEntriesByName('lte:first-rows')[0]?.startTime ?? null")
        heap = page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : null")
        return {"first_rows_ms": round(mark if mark is not None else wall, 1), "heap_mb": round(heap / 2**20, 1) if heap else None}
    except PwTimeout:
        return {"first_rows_ms": None, "heap_mb": None, "failed": f"no rows after {TIMEOUT_MS // 1000} s"}
    finally:
        ctx.close()


def median(xs):
    s = sorted(xs)
    return s[len(s) // 2]


def run(set_name):
    bench = json.load(open(f"reports/bench-{set_name}.json"))
    out = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--enable-precise-memory-info", "--js-flags=--expose-gc"])
        for row in bench["rows"]:
            res = {"trace_id": row["trace_id"], "spans": row["spans"]}
            for name, path in (("windowed", f"/traces/{row['trace_id']}"), ("full", f"/baseline/{row['trace_id']}")):
                measure(browser, BASE + path)  # warm the server and the page bundle
                runs = [measure(browser, BASE + path) for _ in range(REPEATS)]
                ok = [r for r in runs if r["first_rows_ms"] is not None]
                res[f"{name}_first_rows_ms"] = median([r["first_rows_ms"] for r in ok]) if ok else None
                res[f"{name}_heap_mb"] = median([r["heap_mb"] for r in ok if r["heap_mb"] is not None]) if ok else None
                if not ok:
                    res[f"{name}_failed"] = runs[0]["failed"]
            print(json.dumps(res), flush=True)
            out.append(res)
        browser.close()
    json.dump({"set": set_name, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": out}, open(f"reports/browser-{set_name}.json", "w"), indent=2)
    print(f"wrote reports/browser-{set_name}.json")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "dev")
