import { readProject } from "@/src/server/auth";
import { handle, json, problem, TRACE_ID } from "@/src/server/http";
import { search } from "@/src/server/queries/trace";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { traceId: string } }) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!TRACE_ID.test(params.traceId)) return problem(400, "BadRequest", "trace id must be 32 hex characters");
  if (q.length < 2 || q.length > 200) return problem(400, "BadRequest", "search for 2 to 200 characters");
  return handle(async () => json(await search(readProject(), params.traceId, q)));
}
