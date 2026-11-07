import { readProject } from "@/src/server/auth";
import { handle, json, problem, SPAN_ID, TRACE_ID } from "@/src/server/http";
import { detail } from "@/src/server/queries/trace";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { traceId: string; id: string } }) {
  if (!TRACE_ID.test(params.traceId) || !SPAN_ID.test(params.id)) return problem(400, "BadRequest", "bad trace or span id");
  return handle(async () => {
    const d = await detail(readProject(), params.traceId, params.id);
    return d ? json(d) : problem(404, "NotFound", "no such span in this trace");
  });
}
