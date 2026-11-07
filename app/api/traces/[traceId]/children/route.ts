import { readProject } from "@/src/server/auth";
import { handle, json, problem, SPAN_ID, TRACE_ID } from "@/src/server/http";
import { ensureIndex } from "@/src/server/index/store";
import { children, node } from "@/src/server/queries/trace";

export const dynamic = "force-dynamic";

// ?parent=<span id> (omit for the top level) &after=<cursor> &limit=<n>
export async function GET(req: Request, { params }: { params: { traceId: string } }) {
  const u = new URL(req.url);
  const parent = u.searchParams.get("parent");
  const after = u.searchParams.get("after");
  const limit = u.searchParams.get("limit");
  if (!TRACE_ID.test(params.traceId)) return problem(400, "BadRequest", "trace id must be 32 hex characters");
  if (parent && !SPAN_ID.test(parent)) return problem(400, "BadRequest", "parent must be 16 hex characters");
  if (after && !/^\d+$/.test(after)) return problem(400, "BadRequest", "after must be a cursor from a previous page");
  if (limit && !/^\d+$/.test(limit)) return problem(400, "BadRequest", "limit must be a positive integer");
  return handle(async () => {
    const project = readProject();
    const meta = await ensureIndex(project, params.traceId);
    const p = parent ? await node(project, params.traceId, meta, parent) : null;
    if (parent && !p) return problem(404, "NotFound", "no such span in this trace");
    return json(await children(project, params.traceId, meta, p, after ? Number(after) : null, limit ? Number(limit) : undefined));
  });
}
