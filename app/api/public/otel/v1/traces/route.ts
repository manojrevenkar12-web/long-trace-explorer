import { projectFromAuth } from "@/src/server/auth";
import { config } from "@/src/server/config";
import { json, problem } from "@/src/server/http";
import { insertObservations } from "@/src/server/ingest/insert";
import { IngestError, normalise } from "@/src/server/ingest/otlp";

export const dynamic = "force-dynamic";

// OTLP/HTTP with JSON encoding, at the path Langfuse's ingestion uses.
export async function POST(req: Request) {
  const project = projectFromAuth(req.headers.get("authorization"));
  if (!project) return problem(401, "Unauthorized", "send Basic auth with a project's public and secret key");
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return problem(415, "UnsupportedMediaType", "this endpoint accepts OTLP/HTTP JSON (set OTEL_EXPORTER_OTLP_PROTOCOL=http/json); protobuf is not implemented");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem(400, "BadRequest", "body is not JSON");
  }
  try {
    const obs = normalise(body as never, project.id, config().model_prices_usd_per_mtok);
    await insertObservations(obs);
    // OTLP partial-success shape: nothing rejected.
    return json({ partialSuccess: {} });
  } catch (e) {
    if (e instanceof IngestError) return problem(400, "BadRequest", e.message);
    console.error(e);
    return problem(503, "Unavailable", "could not store spans; the exporter should retry");
  }
}
