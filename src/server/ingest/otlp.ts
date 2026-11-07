// OTLP/HTTP JSON (ExportTraceServiceRequest) to observation rows. Langfuse's v4 SDKs export
// OpenTelemetry spans; attribute names follow Langfuse's (langfuse.observation.*) and the
// OpenTelemetry GenAI semantic conventions (gen_ai.*).

export interface Observation {
  project_id: string;
  trace_id: string;
  id: string;
  parent_id: string;
  name: string;
  type: string;
  level: string;
  status_message: string;
  start_time: string; // ISO with microseconds, UTC
  end_time: string;
  model: string;
  tool_name: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  input: string;
  output: string;
  attributes: Record<string, string>;
}

type AnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
};
type KeyValue = { key: string; value?: AnyValue };
type Span = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: KeyValue[];
  status?: { code?: number | string; message?: string };
};
export type ExportRequest = { resourceSpans?: { resource?: { attributes?: KeyValue[] }; scopeSpans?: { spans?: Span[] }[] }[] };

export class IngestError extends Error {}

function value(v: AnyValue | undefined): string {
  if (!v) return "";
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return String(v.intValue);
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.boolValue !== undefined) return String(v.boolValue);
  if (v.arrayValue) return JSON.stringify((v.arrayValue.values ?? []).map(value));
  if (v.kvlistValue) return JSON.stringify(Object.fromEntries((v.kvlistValue.values ?? []).map((kv) => [kv.key, value(kv.value)])));
  return "";
}

const HEX = /^[0-9a-f]+$/i;

// OTLP JSON encodes ids as hex; some exporters send base64 (the protobuf JSON mapping).
export function normaliseId(raw: string | undefined, bytes: number): string {
  if (!raw) return "";
  if (raw.length === bytes * 2 && HEX.test(raw)) return raw.toLowerCase();
  const b = Buffer.from(raw, "base64");
  if (b.length === bytes) return b.toString("hex");
  throw new IngestError(`id ${JSON.stringify(raw).slice(0, 40)} is neither ${bytes * 2} hex characters nor ${bytes} base64 bytes`);
}

export function nanosToIso(n: string | number | undefined): string {
  if (n === undefined || n === "" || n === 0 || n === "0") throw new IngestError("span without a start or end time");
  const big = BigInt(n);
  const micros = big / 1000n;
  const ms = Number(micros / 1000n);
  const frac = Number(micros % 1000n);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new IngestError(`time ${n} is out of range`);
  return d.toISOString().replace("Z", "") + String(frac).padStart(3, "0");
}

const TYPE_BY_OPERATION: Record<string, string> = {
  chat: "GENERATION",
  text_completion: "GENERATION",
  generate_content: "GENERATION",
  embeddings: "EMBEDDING",
  execute_tool: "TOOL",
  invoke_agent: "AGENT",
  create_agent: "AGENT",
};
const TYPES = new Set(["SPAN", "GENERATION", "EVENT", "AGENT", "TOOL", "CHAIN", "RETRIEVER", "EVALUATOR", "EMBEDDING", "GUARDRAIL"]);

export function costUsd(model: string, input: number, output: number, prices: Record<string, { input: number; output: number }>): number {
  const p = prices[model];
  if (!p) return 0;
  return (input * p.input + output * p.output) / 1e6;
}

export function normalise(req: ExportRequest, projectId: string, prices: Record<string, { input: number; output: number }>): Observation[] {
  if (!req || !Array.isArray(req.resourceSpans)) throw new IngestError("body must be an OTLP ExportTraceServiceRequest with resourceSpans");
  const out: Observation[] = [];
  for (const rs of req.resourceSpans) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        const attrs: Record<string, string> = {};
        for (const kv of s.attributes ?? []) attrs[kv.key] = value(kv.value);
        const trace = normaliseId(s.traceId, 16);
        const id = normaliseId(s.spanId, 8);
        if (!trace || !id) throw new IngestError("span without traceId or spanId");
        const op = attrs["gen_ai.operation.name"] ?? "";
        let type = (attrs["langfuse.observation.type"] ?? "").toUpperCase();
        if (!TYPES.has(type)) type = TYPE_BY_OPERATION[op] ?? "SPAN";
        const statusCode = String(s.status?.code ?? "");
        const isError = statusCode === "2" || statusCode === "STATUS_CODE_ERROR";
        const level = (attrs["langfuse.observation.level"] ?? (isError ? "ERROR" : "DEFAULT")).toUpperCase();
        const model = attrs["gen_ai.response.model"] ?? attrs["gen_ai.request.model"] ?? attrs["langfuse.observation.model.name"] ?? "";
        const inTok = Number(attrs["gen_ai.usage.input_tokens"] ?? 0) || 0;
        const outTok = Number(attrs["gen_ai.usage.output_tokens"] ?? 0) || 0;
        const explicitCost = attrs["langfuse.observation.cost_details.total"] ?? attrs["gen_ai.usage.cost"];
        const start = nanosToIso(s.startTimeUnixNano);
        const end = nanosToIso(s.endTimeUnixNano ?? s.startTimeUnixNano);
        const rest: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrs)) {
          if (!k.startsWith("langfuse.observation.input") && !k.startsWith("langfuse.observation.output") && k !== "gen_ai.input.messages" && k !== "gen_ai.output.messages") rest[k] = v;
        }
        out.push({
          project_id: projectId,
          trace_id: trace,
          id,
          parent_id: s.parentSpanId ? normaliseId(s.parentSpanId, 8) : "",
          name: s.name ?? "",
          type,
          level: ["DEBUG", "DEFAULT", "WARNING", "ERROR"].includes(level) ? level : "DEFAULT",
          status_message: s.status?.message ?? attrs["langfuse.observation.status_message"] ?? "",
          start_time: start,
          end_time: end < start ? start : end,
          model,
          tool_name: attrs["gen_ai.tool.name"] ?? "",
          input_tokens: inTok,
          output_tokens: outTok,
          cost_usd: explicitCost !== undefined ? Number(explicitCost) || 0 : costUsd(model, inTok, outTok, prices),
          input: attrs["langfuse.observation.input"] ?? attrs["gen_ai.input.messages"] ?? "",
          output: attrs["langfuse.observation.output"] ?? attrs["gen_ai.output.messages"] ?? "",
          attributes: rest,
        });
      }
    }
  }
  return out;
}
