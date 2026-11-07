# Open a 300,000-span trace in under half a second

_Changelog draft, written the way a launch-week post would be._

Agents run longer than they used to. A research agent that plans, calls tools and hands work to sub-agents for a night can leave a trace with
hundreds of thousands of spans. Until now, opening one meant waiting for every span to download and the tree to be built in your browser.

**Long traces now open from a summary.** You see the whole trace's totals right away: spans, duration, cost, failures and spans that lost their
parent. You see the top level, and the slowest path opened down to the step where the time went. Each collapsed branch tells you what is
inside it: how many spans, what they cost, how many failed. Open a branch and its children load, a page at a time.

- **Search the whole trace**, including spans you have not opened: error messages, tool names, models, inputs and outputs. Pick a hit and
  the explorer opens the path to it.
- **A timeline that works at any scale.** Each bar is drawn within its parent's time, so a 90 ms tool call inside a two-hour sub-agent is
  still visible in a week-long trace.
- **Agent steps.** Every tool, model and sub-agent your agents called, with call counts, failure rates, p50/p95 latency and cost, and which
  step tends to follow which.
- **Spans that lost their parent are shown**, marked as such, instead of disappearing.

On a 300,000-span trace, the first rows appear in 0.38 s with 6 MB of browser memory, against 3.3 s and 213 MB when every span is loaded
(headless Chromium, local ClickHouse; [full numbers](../REPORT.md)). Small traces load the way they always did, quickly.

Send traces with any OpenTelemetry SDK to `/api/public/otel/v1/traces`. Nothing changes in your instrumentation.
