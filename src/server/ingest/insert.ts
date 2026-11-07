import { ch } from "../clickhouse";
import type { Observation } from "./otlp";

export async function insertObservations(obs: Observation[]): Promise<void> {
  if (!obs.length) return;
  await ch().insert({
    table: "observations",
    format: "JSONEachRow",
    values: obs,
    clickhouse_settings: { date_time_input_format: "best_effort", async_insert: 0 },
  });
}
