export interface Row {
  id: string;
  parent_id: string;
  pre: number;
  post: number;
  depth: number;
  child_count: number;
  subtree_size: number;
  subtree_cost: number;
  subtree_tokens: number;
  subtree_errors: number;
  subtree_start: string;
  subtree_end: string;
  critical: number;
  orphan: number;
  name: string;
  type: string;
  level: string;
  model: string;
  tool_name: string;
  start_time: string;
  end_time: string;
  cost_usd: number;
  tokens: number;
  status_message: string;
}

export interface Page {
  parent: string;
  rows: Row[];
  next: number | null;
  total: number;
}

export interface Meta {
  version: string;
  spans: number;
  roots: number;
  orphans: number;
  max_depth: number;
  total_cost: number;
  total_tokens: string;
  errors: number;
  start_time: string;
  end_time: string;
  root_name: string;
  build_ms: number;
}

export interface Summary {
  meta: Meta;
  rebuilt: boolean;
  index_ms: number;
  pages: Page[];
  expanded: string[];
  critical: string[];
}

export interface Hit {
  id: string;
  pre: number;
  name: string;
  type: string;
  level: string;
  field: string;
  ancestors: { id: string; pre: number }[];
}
