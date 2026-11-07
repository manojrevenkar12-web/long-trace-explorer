import { bytes, count, duration } from "@/src/shared/format";
import { color, size, space } from "@/src/shared/theme";
import type { BenchRow } from "./types";

const ms = (x: { p50: number; p95: number } | null) => (x ? `${duration(x.p50)} / ${duration(x.p95)}` : "not run");
const ok = (r: BenchRow) => r.correct.every_span_once && r.correct.totals_match && r.correct.search_reveals;

export function BenchTable({ rows, caption }: { rows: BenchRow[]; caption: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <caption style={{ textAlign: "left", fontSize: size.sm, color: color.muted, paddingBottom: space[2] }}>{caption}</caption>
        <thead>
          <tr>
            <th>Trace</th><th className="r">Spans</th><th className="r">Open p50/p95</th><th className="r">Sent to open</th>
            <th className="r">Expand</th><th className="r">Search</th><th className="r">Full load</th><th className="r">Full size</th>
            <th className="r">Browser, first rows</th><th className="r">First open after new spans</th><th>Checks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.shape}-${r.spans}`}>
              <td><a href={`/traces/${r.trace_id}`}>{r.shape}</a></td>
              <td className="r">{count(r.spans)}</td>
              <td className="r">{ms(r.open_ms)}</td>
              <td className="r">{bytes(r.open_bytes)}</td>
              <td className="r">{ms(r.expand_ms)}</td>
              <td className="r">{ms(r.search_ms)}</td>
              <td className="r" style={{ color: color.muted }}>{ms(r.full_ms)}</td>
              <td className="r" style={{ color: color.muted }}>{r.full_bytes === null ? "" : bytes(r.full_bytes)}</td>
              <td className="r">
                {r.browser ? `${duration(r.browser.windowed_first_rows_ms)} vs ${r.browser.full_first_rows_ms === null ? (r.browser.full_failed ?? "failed") : duration(r.browser.full_first_rows_ms)}` : ""}
              </td>
              <td className="r" title={`index build ${duration(r.index_build_ms)}`}>{duration(r.cold_open_ms)}</td>
              <td style={{ color: ok(r) ? color.muted : color.error }}>{ok(r) ? "all pass" : "failed"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
