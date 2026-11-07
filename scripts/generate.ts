// Sends sample agent traces to a running explorer: `npm run generate -- 5000 50000`.
import { generateTrace, SHAPES } from "../src/sim/agent";
import { BASE, send } from "./lib";

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
const list = sizes.length ? sizes : [2000, 20000];
for (const [i, n] of list.entries()) {
  const { traceId, spans } = generateTrace(100 + i, n, SHAPES.research);
  const ms = await send(spans);
  console.log(`${spans.length} spans in ${Math.round(ms)} ms: ${BASE}/traces/${traceId}`);
}
