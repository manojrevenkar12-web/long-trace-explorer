import { readProject } from "@/src/server/auth";
import { handle, json } from "@/src/server/http";
import { listTraces } from "@/src/server/queries/trace";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => json({ traces: await listTraces(readProject()) }));
}
