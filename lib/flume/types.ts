/**
 * Flume data contract. Every module (parser, graph builder, layout, chart,
 * export, UI) talks through these types. Change them only with care.
 */

/* ───────────────────────────── Input data ───────────────────────────── */

export type FlowType = "income" | "expense" | "savings";

/** One aggregated line of the user's CSV: a total for the whole period. */
export interface FlowRow {
  type: FlowType;
  /** Broad group, e.g. "Salary", "Housing", "Investments". Never empty. */
  category: string;
  /** Optional finer grain, e.g. "Rent". Undefined when absent/blank. */
  subcategory?: string;
  /** Always > 0, in major currency units (dollars, not cents). */
  amount: number;
}

export interface FlumeData {
  /** Optional label for the period, e.g. "October 2026". */
  title?: string;
  /** ISO 4217 code. Defaults to "USD" when the input does not say. */
  currency: string;
  /** Deduplicated: at most one row per (type, category, subcategory). */
  rows: FlowRow[];
}

export interface ParseIssue {
  level: "error" | "warning";
  /** 1-based line number in the text the user gave us, when known. */
  line?: number;
  /** Plain-language, user-facing. Says what to fix. */
  message: string;
}

export interface ParseResult {
  /** Null when the input is unusable (then `issues` has at least one error). */
  data: FlumeData | null;
  issues: ParseIssue[];
}

/* ──────────────────────────────── Graph ─────────────────────────────── */

/** "simple" stops at categories; "full" adds subcategory columns. */
export type Detail = "simple" | "full";

export type NodeKind =
  | "income-detail" // an income subcategory (full detail only)
  | "income" // an income category
  | "shortfall" // synthetic source: spending beyond income ("From savings")
  | "hub" // the single middle node everything flows through
  | "expense" // an expense category
  | "savings" // a savings category
  | "surplus" // synthetic sink: income not spent or saved ("Left over")
  | "expense-detail" // an expense subcategory (full detail only)
  | "savings-detail"; // a savings subcategory (full detail only)

export interface GraphNode {
  /** Stable and unique within the graph, e.g. "expense:Housing/Rent". */
  id: string;
  /** Display label, e.g. "Rent". */
  label: string;
  kind: NodeKind;
  /** 0-based column, left to right, contiguous (no empty columns). */
  column: number;
  /** Total flowing through the node, in major currency units. */
  value: number;
  /**
   * Color key. Nodes that belong together share it: a category and all of
   * its subcategories carry the category's node id. The hub's is "hub".
   */
  group: string;
}

export interface GraphLink {
  /** GraphNode.id of the left end. */
  source: string;
  /** GraphNode.id of the right end. */
  target: string;
  value: number;
  /** Color key: the `group` of whichever end is NOT the hub. */
  group: string;
}

export interface FlumeTotals {
  income: number;
  expenses: number;
  savings: number;
  /** income − expenses − savings when positive, else 0. */
  surplus: number;
  /** expenses + savings − income when positive, else 0. */
  shortfall: number;
}

export interface FlumeGraph {
  title?: string;
  currency: string;
  detail: Detail;
  /** Number of columns actually used (max column + 1). */
  columns: number;
  /** Column index of the hub node. */
  hubColumn: number;
  nodes: GraphNode[];
  links: GraphLink[];
  totals: FlumeTotals;
}

/* ──────────────────────────────── Theme ─────────────────────────────── */

export type ThemeName = "light" | "dark";

export type ExportFormat = "landscape" | "portrait";
