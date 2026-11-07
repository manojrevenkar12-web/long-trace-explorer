import { NextResponse } from "next/server";
import { NotFound } from "./index/store";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function problem(status: number, code: string, message: string) {
  return json({ code, message }, status);
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotFound) return problem(404, "NotFound", e.message);
    console.error(e);
    return problem(502, "Upstream", "the trace store did not answer; try again");
  }
}

export const TRACE_ID = /^[0-9a-f]{32}$/;
export const SPAN_ID = /^[0-9a-f]{16}$/;
