# Working in this repository

A trace explorer for agent runs with hundreds of thousands of spans: OTLP ingestion into ClickHouse, a
precomputed tree index, paged APIs and a Next.js UI that only ever holds what is on screen.

## Fast feedback

```bash
clickhouse server -- --http_port=8123 --listen_host=127.0.0.1   # or the CI service container
npm ci && npm run migrate
npm run typecheck && npm test                                     # 16 tests, about 10 s, uses database lte_test
npm run build && npm start                                        # http://127.0.0.1:3000
npm run generate -- 5000 50000                                    # sample traces over OTLP
```

Benchmarks (minutes): `npm run bench -- --set dev`, `python3 scripts/browser_bench.py dev`, `npm run report`.

## Invariants

1. **The index is the only tree.** Pages, branch totals, search ancestors and the agent steps all read
   `trace_nodes`. Never rebuild the tree in a request handler or in the browser; the baseline page in
   `src/features/baseline` exists only for the benchmark.
2. **Paging returns every span exactly once.** Children of a node are the rows in its `(pre, post]`
   range at depth + 1, paged by a `pre` cursor. `tests/integration.test.ts` walks a whole trace through
   the API; keep it passing for any change to `children()` or `buildIndex()`.
3. **Orphans are shown, never dropped.** A span whose parent never arrived is a top-level node marked
   `orphan`. Cycles are broken and duplicate ids keep one copy.
4. **The tree never ships inputs and outputs.** Only the detail panel reads them, one span at a time,
   capped at `io_preview_bytes`.
5. **Settings live in `config/app.json`** (page sizes, auto-expand depth, prices, benchmark plan). Colours,
   sizes and spacing live in `src/shared/theme.ts`; components never use literals for them.
6. **Every UI feature has loading, error and empty states** (`src/shared/ui/States.tsx`).
7. **Generated files are not edited by hand:** `reports/*.json`, `public/results.json`, `REPORT.md`.

## The held-out rule

`reports/heldout-pin.json` fixes the held-out shapes, size, seed and repeats by hash before they are run.
`npm run bench -- --set heldout` refuses to run if the plan changed or if it already ran. Do not tune
anything against the held-out traces; if a held-out result is bad, report it and fix the cause on the
development traces.
