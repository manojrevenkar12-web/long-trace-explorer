import { createClient } from "@clickhouse/client";
import { migrate } from "../src/server/schema";

const db = process.env.CLICKHOUSE_DB ?? "default";
const admin = createClient({ url: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123", username: process.env.CLICKHOUSE_USER ?? "default", password: process.env.CLICKHOUSE_PASSWORD ?? "" });
await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${db.replace(/[^A-Za-z0-9_]/g, "")}` });
await admin.close();
await migrate();
console.log(`schema ready in ${db}`);
process.exit(0);
