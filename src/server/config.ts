import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Project {
  id: string;
  public_key: string;
  secret_key: string;
}

export interface AppConfig {
  children_page: number;
  auto_expand_depth: number;
  search_limit: number;
  io_preview_bytes: number;
  full_trace_row_limit: number;
  projects: Project[];
  model_prices_usd_per_mtok: Record<string, { input: number; output: number }>;
  bench: { sizes: number[]; full_with_io_max: number; repeats: number; dev_seed: number; heldout_seed: number; heldout_shapes: string[]; heldout_spans: number; walk_max: number };
}

let cached: AppConfig | null = null;

export function config(): AppConfig {
  if (!cached) {
    const path = process.env.APP_CONFIG ?? join(process.cwd(), "config", "app.json");
    cached = JSON.parse(readFileSync(path, "utf8")) as AppConfig;
  }
  return cached;
}
