import { describe, expect, it } from "vitest";
import { costUsd, IngestError, nanosToIso, normalise, normaliseId } from "@/src/server/ingest/otlp";

const prices = { "gpt-4.1": { input: 2, output: 8 } };
const span = (over: Record<string, unknown> = {}, attrs: Record<string, unknown>[] = []) => ({
  resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", parentSpanId: "", name: "s",
    startTimeUnixNano: "1730970000123456789", endTimeUnixNano: "1730970001123456789", attributes: attrs, ...over }] }] }],
});

describe("OTLP normalisation", () => {
  it("accepts hex and base64 ids and refuses anything else", () => {
    expect(normaliseId("0AF7651916CD43DD8448EB211C80319C", 16)).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(normaliseId(Buffer.from("b7ad6b7169203331", "hex").toString("base64"), 8)).toBe("b7ad6b7169203331");
    expect(() => normaliseId("xyz", 8)).toThrow(IngestError);
  });

  it("keeps microseconds from nanosecond timestamps", () => {
    expect(nanosToIso("1730970000123456789")).toBe("2024-11-07T09:00:00.123456");
    expect(() => nanosToIso("0")).toThrow(IngestError);
  });

  it("maps Langfuse and GenAI attributes to an observation", () => {
    const [o] = normalise(span({}, [
      { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
      { key: "gen_ai.request.model", value: { stringValue: "gpt-4.1" } },
      { key: "gen_ai.usage.input_tokens", value: { intValue: "1000" } },
      { key: "gen_ai.usage.output_tokens", value: { intValue: 500 } },
      { key: "langfuse.observation.input", value: { stringValue: "hello" } },
      { key: "custom", value: { boolValue: true } },
    ]) as never, "demo", prices);
    expect(o.type).toBe("GENERATION");
    expect(o.model).toBe("gpt-4.1");
    expect(o.cost_usd).toBeCloseTo(costUsd("gpt-4.1", 1000, 500, prices));
    expect(o.cost_usd).toBeCloseTo(0.006);
    expect(o.input).toBe("hello");
    expect(o.attributes.custom).toBe("true");
    expect(o.attributes["langfuse.observation.input"]).toBeUndefined();
  });

  it("marks failed spans as errors and keeps the message", () => {
    const [o] = normalise(span({ status: { code: 2, message: "boom" } }) as never, "demo", prices);
    expect(o.level).toBe("ERROR");
    expect(o.status_message).toBe("boom");
  });

  it("explicit Langfuse type wins over the GenAI operation", () => {
    const [o] = normalise(span({}, [{ key: "langfuse.observation.type", value: { stringValue: "tool" } }, { key: "gen_ai.operation.name", value: { stringValue: "chat" } }]) as never, "demo", prices);
    expect(o.type).toBe("TOOL");
  });

  it("refuses bodies that are not OTLP", () => {
    expect(() => normalise({} as never, "demo", prices)).toThrow(IngestError);
    expect(() => normalise(span({ spanId: "" }) as never, "demo", prices)).toThrow(IngestError);
  });
});
