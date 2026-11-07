import { readProject } from "@/src/server/auth";
import { handle, json, problem, TRACE_ID } from "@/src/server/http";
import { full } from "@/src/server/queries/trace";

export const dynamic = "force-dynamic";

// The baseline the benchmark compares against: the whole trace in one response (?io=1 adds inputs and outputs).
export async function GET(req: Request, { params }: { params: { traceId: string } }) {
  if (!TRACE_ID.test(params.traceId)) return problem(400, "BadRequest", "trace id must be 32 hex characters");
  const io = new URL(req.url).searchParams.get("io") === "1";
  return handle(async () => json({ observations: await full(readProject(), params.traceId, io) }));
}
