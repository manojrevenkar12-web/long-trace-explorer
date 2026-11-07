import { createClient, type ClickHouseClient } from "@clickhouse/client";

let client: ClickHouseClient | null = null;

export function ch(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
      clickhouse_settings: { date_time_output_format: "iso" },
      max_open_connections: 16,
    });
  }
  return client;
}

export async function rows<T>(query: string, query_params: Record<string, unknown> = {}): Promise<T[]> {
  const rs = await ch().query({ query, query_params, format: "JSONEachRow" });
  return rs.json<T>();
}
