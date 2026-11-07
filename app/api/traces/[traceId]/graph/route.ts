import { readProject } from "@/src/server/auth";
import { handle, json, problem, TRACE_ID } from "@/src/server/http";
import { graph } from "@/src/server/queries/trace";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { traceId: string } }) {
  if (!TRACE_ID.test(params.traceId)) return problem(400, "BadRequest", "trace id must be 32 hex characters");
  return handle(async () => json(await graph(readProject(), params.traceId)));
}
