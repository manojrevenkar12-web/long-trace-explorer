// Every colour, face and size the UI uses. Components read these, never literals.
// A flight-recorder palette: navy instrument panel, one colour per kind of step.
export const color = {
  bg: "#0F1B2D",
  panel: "#14233A",
  raised: "#1A2C47",
  line: "#25395A",
  text: "#E6EBF2",
  muted: "#93A3BA",
  faint: "#5E7190",
  focus: "#F2B33D",
  select: "#203A5E",
  error: "#F2665C",
  warning: "#E8A23A",
} as const;

export const kindColor: Record<string, string> = {
  GENERATION: "#F2B33D",
  TOOL: "#4FC1B0",
  AGENT: "#A99BF0",
  RETRIEVER: "#6FB4F2",
  CHAIN: "#C58FD8",
  EMBEDDING: "#6FB4F2",
  SPAN: "#93A3BA",
  EVENT: "#93A3BA",
};

export const font = { ui: "'IBM Plex Sans', system-ui, sans-serif" } as const;
// 1.2 scale from 14 px; the tree is dense, headings are not.
export const size = { xs: 11.5, sm: 12.5, base: 14, md: 16.8, lg: 20.2, xl: 24.2, xxl: 41.8 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 } as const;
export const radius = { s: 3, m: 6 } as const;
export const layout = { rowHeight: 28, indent: 14, maxWidth: 1240, treeMinWidth: 380 } as const;
export const ease = [0.2, 0.8, 0.2, 1] as const;

export function cssVariables(): string {
  return `:root{${Object.entries(color).map(([k, v]) => `--${k}:${v};`).join("")}}`;
}
