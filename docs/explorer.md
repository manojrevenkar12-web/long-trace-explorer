# How the explorer opens a long trace

## The problem

A trace view usually asks for every observation of a trace, builds the parent-child tree in the browser and renders it. The cost of that
grows with the trace: bytes to download, JSON to parse, objects to keep in memory. An agent that runs overnight can produce 100,000+ spans,
and at that size the first screen waits for all of them.

## The index

When spans arrive, nothing else happens: ingestion is a plain insert. The first read of a trace whose spans changed since the last read
builds its index in one pass:

| Column | Meaning |
|---|---|
| `pre`, `post` | Depth-first visit order on entry and the largest `pre` inside the branch. A node's descendants are exactly `pre < x <= post`. |
| `depth`, `child_count` | Where the node is, and whether it can be opened. |
| `subtree_size`, `subtree_cost`, `subtree_tokens`, `subtree_errors`, `subtree_start/end` | Totals of the whole branch, shown on a collapsed row. |
| `critical` | On the slowest path: at every level, the child with the longest branch. |
| `orphan` | The parent never arrived; the node is shown at the top level. |
| `name`, `type`, `level`, `model`, `tool_name`, times, cost, the start of the error | What a row shows, so pages never read the raw spans. |

Children are sorted by start time, so `pre` order is also time order among siblings. The table is ordered by
`(project_id, trace_id, version, pre)`. A page of children is one range read: `pre BETWEEN parent.pre + 1 AND parent.post AND
depth = parent.depth + 1 AND pre > cursor ORDER BY pre LIMIT n`.

A newer version replaces the old one atomically. Readers use the version in `trace_index_meta`, and older versions are deleted after the
switch. An index is stale when the trace's newest `ingested_at` is later than the one the index was built from. That check reads a single
column, so it stays cheap.

## Search

Search scans names, tools, models, error messages, inputs and outputs of the trace's raw spans (case-insensitive), up to 100 hits. For each
hit, the ancestors are the nodes whose `[pre, post]` contains the hit's `pre`, and one query returns them for all hits. The UI walks that
chain: for every ancestor not loaded yet, it fetches the page of children that starts at the next node on the chain. So a hit 30 levels
down in an unopened branch costs at most 30 small range reads, not the whole branch.

## Agent steps

For every agent span, its direct children are labelled by tool, model or sub-agent and grouped (calls, failures, p50/p95, cost).
`lagInFrame` over the children, partitioned by parent and ordered by start time, gives the step before each step: that is the transition
matrix.

## The UI

`src/features/trace-tree/useTree.ts` keeps one entry per loaded branch: its rows, a cursor, and whether the branch was entered in the middle.
The visible tree is a flat list of lines built from the branches that are open. The list is virtualised, so only about 40 rows exist in the
DOM. Every remote state has a loading, an error (with retry) and an empty form. Motion is used where it shows a change: the chevron turning,
the detail panel swapping, the tab underline moving, and the one comparison drawn on the home page.
