/**
 * Pure Sankey geometry: FlumeGraph + a box → everything a renderer needs in
 * pixels. No DOM, no React. The on-screen SVG chart and the canvas PNG export
 * both draw from the same `SankeyLayout`, so they cannot drift apart.
 *
 * How it works, in order:
 *  1. d3-sankey wires the graph (who links to whom, link order per node) with
 *     the given columns and node order honored, never re-sorted.
 *  2. A vertical pass picks one value→pixel scale and places every column:
 *     columns are centered on the hub, gaps grow around small nodes so their
 *     labels fit, and detail nodes sit in clusters centered on their parent.
 *     d3-sankey then stacks the links along each node (`sankey.update`).
 *  3. Labels are de-collided per column (nudge → single line → hide smallest).
 *  4. A horizontal pass sizes margins and column gaps from real label widths,
 *     truncating names only when the box is too narrow for them.
 *  5. Ribbons are emitted as closed, fillable SVG paths.
 */
import { sankey as d3Sankey, type SankeyLink, type SankeyNode } from "d3-sankey";
import { formatMoney, formatPercent } from "./format";
import { HATCHED_KINDS } from "./palette";
import type { FlumeGraph, GraphNode, NodeKind } from "./types";

/* ──────────────────────────────── Types ─────────────────────────────── */

export interface TextFont {
  /** Font size in px. */
  size: number;
  /** CSS font-weight, e.g. 400 or 600. */
  weight: number;
  /**
   * Set for amounts. The SVG chart draws them in tabular figures
   * (`font-variant-numeric: tabular-nums`), where every digit has the same
   * width; a measurer that draws amounts that way should measure them that
   * way. A canvas, which has no such switch, can ignore the flag.
   */
  tabular?: boolean;
}

/** Width in px of `text` set in `font` (the chart's UI sans). */
export type MeasureText = (text: string, font: TextFont) => number;

export interface ComputeLayoutOptions {
  /** Outer box, px. Everything returned lies inside it. */
  width: number;
  height: number;
  /** Phone layout: smaller type, thinner nodes, tighter gaps. */
  compact?: boolean;
  /** Privacy mode: show each amount as a share of the hub instead. */
  hideAmounts?: boolean;
  /**
   * Label font size in px. Defaults to 13 (11 when compact). Every other
   * dimension (node width, gaps, paddings) scales with it, so an exporter
   * can ask for a 2400px-wide layout with `fontSize: 28` and get the same
   * proportions as the on-screen chart.
   */
  fontSize?: number;
  /** Real text measurement. Without it a character-width estimate is used. */
  measureText?: MeasureText;
}

export type LabelSide = "left" | "right" | "top";
export type TextAnchor = "start" | "middle" | "end";

/** One piece of text, fully positioned. Draw it as-is. */
export interface LayoutTextRun {
  role: "name" | "amount";
  text: string;
  /** Anchor x. */
  x: number;
  /** Alphabetic baseline y. */
  y: number;
  anchor: TextAnchor;
  fontSize: number;
  fontWeight: number;
}

export interface LayoutLabel {
  /** Which side of its node the label sits on ("top" is the hub). */
  side: LabelSide;
  /**
   * "stacked": name over amount. "inline": name and amount on one line.
   * ("split" is no longer produced; it stays in the type for old callers.)
   */
  arrangement: "stacked" | "inline" | "split";
  anchor: TextAnchor;
  /** Anchor x of the block and its vertical center. */
  x: number;
  y: number;
  /**
   * Text to draw: a "name" run and an "amount" run. The amount run is left
   * out only when a one-line label had no room for it (narrow phones with
   * many columns); `LayoutNode.amountText` always has the amount.
   */
  runs: LayoutTextRun[];
  /** Bounding box of the text block. */
  box: { x: number; y: number; width: number; height: number };
  /** True when the name was shortened with an ellipsis. */
  truncated: boolean;
  /**
   * True when the label sits over ribbons and wants a background-colored
   * outline behind the glyphs (SVG `paint-order: stroke`, canvas strokeText).
   */
  halo: boolean;
  /** Thin line from the node to a label that was nudged away from it. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
  /** The hub's label: larger amount, centered above the node. */
  prominent: boolean;
}

export interface LayoutNode {
  id: string;
  /** Full display name (never truncated). */
  name: string;
  kind: NodeKind;
  /** Color key: look it up in `getFlowColors(graph, theme)`. */
  group: string;
  column: number;
  value: number;
  /** value / hub value, 0..1 (can exceed 1 only for malformed graphs). */
  share: number;
  /** Full, untruncated amount text ("$2,150", or "28%" when hiding amounts). */
  amountText: string;
  /** Rectangle to draw. Small nodes are padded to a minimum height. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius for the rectangle. */
  radius: number;
  /** Draw hatched rather than solid ("Left over", "From savings"). */
  hatched: boolean;
  /** Null when the label was hidden to avoid a collision. */
  label: LayoutLabel | null;
}

export interface LayoutLink {
  /** `${source}->${target}` */
  id: string;
  /** Index in `layout.links` (draw order). */
  index: number;
  /** LayoutNode ids. */
  source: string;
  target: string;
  /** Color key of the link (the non-hub end). */
  group: string;
  /** Color keys of the two end nodes, for a source→target gradient. */
  sourceGroup: string;
  targetGroup: string;
  value: number;
  share: number;
  /** Column of the source node; links in one column animate together. */
  column: number;
  /**
   * Closed outline of the ribbon as an SVG path. Fill it; do not stroke it.
   * Works unchanged with `new Path2D(path)` on a canvas.
   */
  path: string;
  /** x where the ribbon leaves the source and reaches the target. */
  x0: number;
  x1: number;
  /** Vertical center of the ribbon at each end. */
  y0: number;
  y1: number;
  /** Ribbon thickness at each end, px. */
  sourceWidth: number;
  targetWidth: number;
  hatched: boolean;
}

/** What `formatFlowAmount` needs to format a value the way labels do. */
export interface AmountFormat {
  currency: string;
  hubValue: number;
  hideAmounts: boolean;
  compact: boolean;
}

export interface SankeyLayout {
  width: number;
  height: number;
  compact: boolean;
  hideAmounts: boolean;
  /** Base label font size the layout was computed for. */
  fontSize: number;
  /**
   * Space the layout reserved around the node area: outer labels live in
   * `left`/`right`, the hub's label in `top`.
   */
  margin: { top: number; right: number; bottom: number; left: number };
  columns: number;
  hubColumn: number;
  /** Left x of the nodes in each column. */
  columnX: number[];
  /** Node width in each column (the hub is a little wider). */
  columnWidth: number[];
  /** Pixels per currency unit. */
  scale: number;
  hubValue: number;
  amountFormat: AmountFormat;
  /** In graph order. */
  nodes: LayoutNode[];
  /** In draw order (by source, then target). */
  links: LayoutLink[];
}

/* ───────────────────────────── Formatting ───────────────────────────── */

/**
 * The amount text used in labels: whole currency units ("$2,150"), or the
 * share of the hub when amounts are hidden ("28%").
 */
export function formatFlowAmount(value: number, f: AmountFormat): string {
  if (f.hideAmounts) return formatPercent(value, f.hubValue);
  const v = Math.abs(value) >= 10 ? Math.round(value) : value;
  const short = Math.abs(v) >= (f.compact ? 10_000 : 1_000_000);
  return formatMoney(v, f.currency, { compact: short });
}

/* ─────────────────────────── Text measurement ───────────────────────── */

const NARROW = new Set("iljtfrI.,:;'|![]()-/ ".split(""));
const WIDE = new Set("mwMW%@—…".split(""));

/** Fallback when no `measureText` is given: tuned for a Geist/Inter-like sans. */
export function estimateTextWidth(text: string, font: TextFont): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") em += 0.61;
    else if (ch === " ") em += 0.27;
    else if (ch === "r" || ch === "t" || ch === "f") em += 0.37;
    else if (NARROW.has(ch)) em += 0.29;
    else if (WIDE.has(ch)) em += 0.86;
    else if (ch === "$" || ch === "€" || ch === "£" || ch === "¥") em += 0.62;
    else if (ch >= "A" && ch <= "Z") em += 0.68;
    else if (ch.charCodeAt(0) > 0x2e7f) em += 1; // CJK
    else em += 0.56;
  }
  return em * font.size * (1 + (font.weight - 400) * 0.00012);
}

function truncateToWidth(
  text: string,
  maxWidth: number,
  font: TextFont,
  measure: MeasureText,
): { text: string; width: number; truncated: boolean } {
  const full = measure(text, font);
  // Half a pixel of grace: the budget is often this very width, recomputed.
  if (full <= maxWidth + 0.5) return { text, width: full, truncated: false };
  const chars = Array.from(text);
  let lo = 1;
  let hi = chars.length - 1;
  const cut = (n: number) => chars.slice(0, n).join("").trimEnd() + "…";
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(cut(mid), font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const out = cut(Math.max(1, lo));
  return { text: out, width: measure(out, font), truncated: true };
}

/* ───────────────────────────── 1-D spreading ────────────────────────── */

interface SpreadItem {
  /** Where the item's center would like to be. */
  target: number;
  size: number;
  /** Minimum gap between this item and the previous one. */
  gap: number;
  /** How strongly the item holds on to its target (default 1). */
  weight?: number;
}

/**
 * Places ordered items in [lo, hi] without overlap, each as close to its
 * target as possible (least squares, order preserved). Returns centers.
 * This is isotonic regression (pool-adjacent-violators) on the centers after
 * subtracting each item's minimum offset from the first.
 */
function spread(items: SpreadItem[], lo: number, hi: number): number[] {
  const n = items.length;
  if (n === 0) return [];
  const offset = new Array<number>(n);
  offset[0] = 0;
  for (let i = 1; i < n; i++) {
    offset[i] = offset[i - 1] + items[i - 1].size / 2 + items[i].gap + items[i].size / 2;
  }
  // Blocks of items that move together.
  const sum: number[] = [];
  const weight: number[] = [];
  const count: number[] = [];
  for (let i = 0; i < n; i++) {
    const w = items[i].weight ?? 1;
    sum.push((items[i].target - offset[i]) * w);
    weight.push(w);
    count.push(1);
    while (sum.length > 1) {
      const m = sum.length;
      if (sum[m - 2] / weight[m - 2] <= sum[m - 1] / weight[m - 1]) break;
      sum[m - 2] += sum[m - 1];
      weight[m - 2] += weight[m - 1];
      count[m - 2] += count[m - 1];
      sum.pop();
      weight.pop();
      count.pop();
    }
  }
  let min = lo + items[0].size / 2;
  let max = hi - items[n - 1].size / 2 - offset[n - 1];
  if (max < min) min = max = (min + max) / 2; // does not fit: overflow evenly
  const out = new Array<number>(n);
  let i = 0;
  for (let b = 0; b < sum.length; b++) {
    const u = Math.min(max, Math.max(min, sum[b] / weight[b]));
    for (let j = 0; j < count[b]; j++, i++) out[i] = u + offset[i];
  }
  return out;
}

/* ─────────────────────────────── Ribbons ────────────────────────────── */

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Horizontal progress of the ribbon centerline at parameter t (0..1). */
const curveX = (t: number) => 1.5 * t * (1 - t) + t * t * t;
/** Vertical progress of the ribbon centerline at parameter t (0..1). */
const curveY = (t: number) => t * t * (3 - 2 * t);

interface Ribbon {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  /** Thickness that is slope-compensated (see `ribbonThickness`). */
  comp: number;
}

/**
 * Vertical thickness of a ribbon at parameter t. A ribbon drawn as "the same
 * curve shifted down by its width" looks pinched where it runs steeply,
 * because what the eye reads is thickness across the flow. Thin ribbons would
 * nearly vanish mid-way, so up to `comp` px of every ribbon is thickened by
 * 1/cos(slope); wide ribbons are left almost untouched, which keeps
 * neighbors from bulging into each other.
 */
function ribbonThickness(rb: Ribbon, t: number): number {
  const dx = (rb.x1 - rb.x0) * (1.5 - 3 * t + 3 * t * t);
  const dy = (rb.y1 - rb.y0) * 6 * t * (1 - t);
  if (dx <= 0) return rb.width;
  const sec = Math.min(3, Math.sqrt(1 + (dy / dx) * (dy / dx)));
  return rb.width + rb.comp * (sec - 1);
}

function ribbonPath(rb: Ribbon): string {
  const { x0, y0, x1, y1, width } = rb;
  const half = width / 2;
  const mid = (x0 + x1) / 2;
  const maxExtra = ribbonThickness(rb, 0.5) - width;
  if (Math.abs(y1 - y0) < 0.05) {
    return `M${r2(x0)},${r2(y0 - half)}H${r2(x1)}V${r2(y1 + half)}H${r2(x0)}Z`;
  }
  if (maxExtra < 0.3) {
    return (
      `M${r2(x0)},${r2(y0 - half)}` +
      `C${r2(mid)},${r2(y0 - half)} ${r2(mid)},${r2(y1 - half)} ${r2(x1)},${r2(y1 - half)}` +
      `V${r2(y1 + half)}` +
      `C${r2(mid)},${r2(y1 + half)} ${r2(mid)},${r2(y0 + half)} ${r2(x0)},${r2(y0 + half)}Z`
    );
  }
  const N = 12;
  const top: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = x0 + (x1 - x0) * curveX(t);
    const y = y0 + (y1 - y0) * curveY(t);
    const h = ribbonThickness(rb, t) / 2;
    top.push([x, y - h]);
    bottom.push([x, y + h]);
  }
  bottom.reverse();
  return (
    `M${r2(top[0][0])},${r2(top[0][1])}` +
    smoothThrough(top) +
    `L${r2(bottom[0][0])},${r2(bottom[0][1])}` +
    smoothThrough(bottom) +
    "Z"
  );
}

/** Catmull-Rom through the points as cubic segments, flat at both ends. */
function smoothThrough(pts: Array<[number, number]>): string {
  let d = "";
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? [2 * pts[0][0] - pts[1][0], pts[0][1]] : pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i === n - 2 ? [2 * pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1]] : pts[i + 2];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${r2(c1x)},${r2(c1y)} ${r2(c2x)},${r2(c2y)} ${r2(p2[0])},${r2(p2[1])}`;
  }
  return d;
}

/** Top edge (smallest y) of a ribbon at horizontal position x. */
function ribbonTopAt(rb: Ribbon, x: number): number {
  if (x <= rb.x0) return rb.y0 - rb.width / 2;
  if (x >= rb.x1) return rb.y1 - rb.width / 2;
  const target = (x - rb.x0) / (rb.x1 - rb.x0);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (curveX(m) < target) lo = m;
    else hi = m;
  }
  const t = (lo + hi) / 2;
  return rb.y0 + (rb.y1 - rb.y0) * curveY(t) - ribbonThickness(rb, t) / 2;
}

/* ───────────────────────────── Working types ────────────────────────── */

interface NodeDatum {
  src: GraphNode;
  rank: number;
  order: number;
  fixedValue: number;
}
interface LinkDatum {
  source: string;
  target: string;
  value: number;
  group: string;
}
type SNode = SankeyNode<NodeDatum, LinkDatum>;
type SLink = SankeyLink<NodeDatum, LinkDatum>;

interface Work {
  node: SNode;
  src: GraphNode;
  rank: number;
  value: number;
  side: LabelSide;
  /** Drawn rectangle, inner coordinates (before margins). */
  top: number;
  drawH: number;
  /** Toward-the-hub neighbor, for detail nodes. */
  parent: Work | null;
  nameW: number;
  amountW: number;
  amountText: string;
  /** Label center in outer coordinates, or null when hidden. */
  labelY: number | null;
  style: LabelStyle;
  /** True when ribbons leave the node on the side its label sits on. */
  flowBehind: boolean;
  /** How far an "above" caption may climb over its node (room reserved). */
  rise: number;
}

type Arrangement = "stacked" | "inline";
/**
 * "above": a caption sitting just above a thin node and the ribbons that fan
 * out of it (one line; name over amount on phones, where width is scarce).
 */
type LabelStyle = Arrangement | "above";

function sectionOf(kind: NodeKind): string {
  switch (kind) {
    case "income":
    case "income-detail":
      return "income";
    case "expense":
    case "expense-detail":
      return "expense";
    case "savings":
    case "savings-detail":
      return "savings";
    default:
      return kind;
  }
}

/* ──────────────────────────────── Layout ────────────────────────────── */

export function computeLayout(graph: FlumeGraph, opts: ComputeLayoutOptions): SankeyLayout {
  return build(graph, opts);
}

/**
 * The height (outer, px) at which a chart with detail columns is
 * comfortable: every category shares a level band with its details, every
 * label shows, and the hub is a healthy share of the height. Returns 0 when
 * the graph has no detail column (any reasonable height works then).
 *
 * `computeLayout` keeps the bands at any height by thinning nodes and then
 * dropping labels; this is the height at which it has to do neither. It
 * depends on the graph and the type size only, never on the width.
 */
export function idealLayoutHeight(
  graph: FlumeGraph,
  opts: {
    /** Phone metrics; detail labels are then two lines unless `oneLine`. */
    compact?: boolean;
    fontSize?: number;
    /** Size for one-line detail labels (always the case when not compact). */
    oneLine?: boolean;
  } = {},
): number {
  let found = 0;
  build(graph, { width: 1000, height: 1000, compact: opts.compact, fontSize: opts.fontSize }, (fit, info) => {
    if (!info.hasDetails) return;
    const plan: Arrangement = opts.oneLine || !opts.compact ? "inline" : "stacked";
    const ok = (h: number) => {
      const r = fit(h - 2 * info.marginY, plan);
      return r.labelFit >= 1 && r.fill >= info.comfortFill;
    };
    let lo = 60;
    let hi = 240;
    while (!ok(hi) && hi < 30000) {
      lo = hi;
      hi *= 2;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid;
      else lo = mid;
    }
    found = Math.ceil(hi);
  });
  return found;
}

interface VerticalFit {
  /** Pixels per currency unit. */
  scale: number;
  /** 1 when every label has its room; less when labels had to give way. */
  labelFit: number;
  /** Share of the inner height the largest column's nodes fill. */
  fill: number;
}
type FitProbe = (
  fit: (innerHeight: number, force?: Arrangement) => VerticalFit,
  info: { marginY: number; comfortFill: number; hasDetails: boolean },
) => void;

function build(graph: FlumeGraph, opts: ComputeLayoutOptions, probe?: FitProbe): SankeyLayout {
  const width = Math.max(1, opts.width);
  const height = Math.max(1, opts.height);
  const compact = !!opts.compact;
  const hideAmounts = !!opts.hideAmounts;
  const baseFs = compact ? 11 : 13;
  const fs = opts.fontSize && opts.fontSize > 0 ? opts.fontSize : baseFs;
  const u = fs / baseFs;
  const rawMeasure = opts.measureText ?? estimateTextWidth;
  const measure: MeasureText = (text, font) => rawMeasure(text, font);
  const measureAmount: MeasureText = (text, font) => rawMeasure(text, { ...font, tabular: true });

  /* Dimensions; everything scales with the font size. */
  const nameFont: TextFont = { size: fs, weight: 500 };
  const amountFont: TextFont = { size: Math.round((fs - 1 * u) * 2) / 2, weight: 400 };
  const hubNameFont: TextFont = { size: fs, weight: 500 };
  const hubAmountFont: TextFont = { size: Math.round(fs * (compact ? 1.5 : 1.7)), weight: 600 };
  const nodeW = (compact ? 7 : 12) * u;
  const hubW = (compact ? 9 : 16) * u;
  const labelOffset = (compact ? 6 : 9) * u;
  const edgePad = (compact ? 2 : 4) * u;
  const groupGap = (compact ? 10 : 18) * u;
  const siblingGap = (compact ? 4 : 6) * u;
  const minNodeH = (compact ? 2 : 2.5) * u;
  const nodeRadius = (compact ? 2 : 3) * u;
  const linkGap = (compact ? 1 : 1.5) * u;
  const minLinkW = 1 * u;
  const minHubGap = (compact ? 44 : 96) * u;
  const minGap = (compact ? 20 : 56) * u;
  const inlineGap = 0.45 * fs;
  const labelGapY = (compact ? 2 : 3) * u;
  const clearance = (compact ? 5 : 10) * u;
  const leaderRun = (compact ? 5 : 8) * u;
  const stackedH = nameFont.size * 1.2 + amountFont.size * 1.25;
  const inlineH = fs * 1.32;
  const captionPad = 1.5 * u;
  const captionH = compact ? stackedH : inlineH;
  // A caption climbs at most this far to stay above its node's top ribbon.
  const riseCap = inlineH * 1.25;
  // With amounts hidden the hub shows its name alone, in the large style.
  const hubLabelH = hideAmounts ? hubAmountFont.size * 1.16 : hubNameFont.size * 1.3 + hubAmountFont.size * 1.12;
  const hubLabelGap = (compact ? 6 : 9) * u;
  const marginY = (compact ? 6 : 10) * u;
  // Bands (a category and its details) keep at least this much between the
  // labels of one and the next.
  const bandLabelGap = (compact ? 4 : 5) * u;
  // When height is short the nodes thin out, but the largest column keeps
  // at least this share of the height; past that, labels give way instead.
  const minFill = 0.22;
  // Two-line detail labels are used while they cost at most this much node
  // thickness compared with one-line labels.
  const stackedWorth = compact ? 0.6 : 0.85;
  // What `idealLayoutHeight` aims for: the largest column's share of height.
  const comfortFill = compact ? 0.4 : 0.44;
  // A column's labels are stacked (name over amount) while they fill at most
  // this share of the height. Phones stack as long as they possibly can:
  // stacked labels are narrow, and width is what a phone lacks.
  const stackedFill = compact ? 0.92 : 0.72;

  const emptyLayout = (): SankeyLayout => ({
    width,
    height,
    compact,
    hideAmounts,
    fontSize: fs,
    margin: { top: marginY, right: edgePad, bottom: marginY, left: edgePad },
    columns: 0,
    hubColumn: 0,
    columnX: [],
    columnWidth: [],
    scale: 0,
    hubValue: 0,
    amountFormat: { currency: graph.currency, hubValue: 0, hideAmounts, compact },
    nodes: [],
    links: [],
  });
  if (graph.nodes.length === 0) return emptyLayout();

  /* ── 1. Wire the graph with d3-sankey ── */

  const columnValues = [...new Set(graph.nodes.map((n) => n.column))].sort((a, b) => a - b);
  const rankOf = new Map(columnValues.map((c, i) => [c, i]));
  const columns = Math.max(1, columnValues.length);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const rank = (n: GraphNode) => rankOf.get(n.column) ?? 0;

  const linkData: LinkDatum[] = [];
  for (const l of graph.links) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    // Only left-to-right links between known nodes can be drawn.
    if (!s || !t || !(l.value > 0) || rank(s) >= rank(t)) continue;
    linkData.push({ source: l.source, target: l.target, value: l.value, group: l.group });
  }
  const inSum = new Map<string, number>();
  const outSum = new Map<string, number>();
  for (const l of linkData) {
    outSum.set(l.source, (outSum.get(l.source) ?? 0) + l.value);
    inSum.set(l.target, (inSum.get(l.target) ?? 0) + l.value);
  }
  const nodeData: NodeDatum[] = graph.nodes.map((n, i) => {
    const through = Math.max(inSum.get(n.id) ?? 0, outSum.get(n.id) ?? 0);
    return { src: n, rank: rank(n), order: i, fixedValue: through > 0 ? through : Math.max(0, n.value) };
  });

  const hubSrc = graph.nodes.find((n) => n.kind === "hub");
  const hubRank = hubSrc ? rank(hubSrc) : (rankOf.get(graph.hubColumn) ?? 0);

  const generator = d3Sankey<NodeDatum, LinkDatum>()
    .nodeId((d) => d.src.id)
    // Honor the graph: its column is the column, its order is the order.
    .nodeAlign((d) => d.rank)
    .nodeSort(null)
    .linkSort((a, b) => {
      const as = a.source as SNode;
      const bs = b.source as SNode;
      const at = a.target as SNode;
      const bt = b.target as SNode;
      return as.order - bs.order || at.order - bt.order;
    })
    .nodeWidth(1)
    .nodePadding(0)
    .iterations(0)
    .extent([
      [0, 0],
      [columns, 1],
    ]);

  let wired: { nodes: SNode[]; links: SLink[] };
  try {
    wired = generator({ nodes: nodeData, links: linkData });
  } catch {
    // A cycle or other malformed input: draw the nodes without links.
    wired = generator({ nodes: nodeData.map((d) => ({ ...d })), links: [] });
  }

  const hubNode = wired.nodes.find((n) => n.src.kind === "hub");
  const hubValue = hubNode?.fixedValue || Math.max(graph.totals.income, graph.totals.expenses + graph.totals.savings, 1e-9);
  const amountFormat: AmountFormat = { currency: graph.currency, hubValue, hideAmounts, compact };

  const work: Work[] = wired.nodes.map((node) => {
    const r = node.rank;
    const amountText = formatFlowAmount(node.fixedValue, amountFormat);
    const isHub = node.src.kind === "hub";
    return {
      node,
      src: node.src,
      rank: r,
      value: node.fixedValue,
      side: isHub || r === hubRank ? "top" : r < hubRank ? "left" : "right",
      top: 0,
      drawH: 0,
      parent: null,
      nameW: measure(node.src.label, isHub ? (hideAmounts ? hubAmountFont : hubNameFont) : nameFont),
      amountW: isHub && hideAmounts ? 0 : measureAmount(amountText, isHub ? hubAmountFont : amountFont),
      amountText,
      labelY: null,
      style: "stacked",
      flowBehind: false,
      rise: 0,
    };
  });
  const workOf = new Map(work.map((w) => [w.node, w]));
  for (const w of work) {
    if (w.rank > hubRank + 1) {
      const link = w.node.targetLinks?.[0];
      w.parent = link ? (workOf.get(link.source as SNode) ?? null) : null;
    } else if (w.rank < hubRank - 1) {
      const link = w.node.sourceLinks?.[0];
      w.parent = link ? (workOf.get(link.target as SNode) ?? null) : null;
    }
  }
  for (const w of work) {
    const inner = w.rank > 0 && w.rank < columns - 1;
    const flows = w.side === "left" ? w.node.targetLinks : w.node.sourceLinks;
    w.flowBehind = inner && w.side !== "top" && (flows?.length ?? 0) > 0;
  }
  const cols: Work[][] = Array.from({ length: columns }, () => []);
  for (const w of work) cols[w.rank].push(w);
  const colW = cols.map((_, c) => (c === hubRank ? hubW : nodeW));

  /* ── 2–5. Solve for a given top margin; the hub label may need more. ── */

  /* ── 2. Vertical: one scale, and bands that never interleave ──
     On each side of the hub a category and its details share one horizontal
     band: both are centered on the band, so the ribbons between them stay
     inside it, and a category without details has a band to itself. Bands
     are stacked, never overlapped. When the height is short the value scale
     shrinks first (thin, level ribbons), then labels give way; the bands
     themselves always hold. */

  type Band = { cat: Work | null; kids: Work[]; section: string };
  const sides: Array<{ catRank: number; detRank: number | null; bands: Band[] }> = [];
  for (const dir of [-1, 1]) {
    const catRank = hubRank + dir;
    const catCol = cols[catRank];
    if (!catCol || catCol.length === 0) continue;
    const detRank = hubRank + 2 * dir;
    const detCol = cols[detRank] ?? [];
    const kidsOf = new Map<Work, Work[]>();
    const orphans: Work[] = [];
    for (const w of detCol) {
      if (w.parent && w.parent.rank === catRank) kidsOf.set(w.parent, [...(kidsOf.get(w.parent) ?? []), w]);
      else orphans.push(w);
    }
    const bands: Band[] = catCol.map((cat) => ({ cat, kids: kidsOf.get(cat) ?? [], section: sectionOf(cat.src.kind) }));
    for (const w of orphans) bands.push({ cat: null, kids: [w], section: sectionOf(w.src.kind) });
    sides.push({ catRank, detRank: detCol.length > 0 ? detRank : null, bands });
  }
  const detailRanks = sides.flatMap((side) => (side.detRank === null ? [] : [side.detRank]));
  const maxColValue = Math.max(1e-9, ...cols.map((col) => col.reduce((sum, w) => sum + w.value, 0)));

  const fitVertical = (innerH: number, force?: Arrangement) => {
    // Last-resort squeeze (1 = none, 0 = full) of what is otherwise fixed:
    // the gaps between siblings and bands, and the minimum node height.
    let squeeze = 1;
    const eased = (tight: number, normal: number) => tight + (normal - tight) * squeeze;
    const heightAt = (w: Work, k: number) => Math.max(w.value * k, eased(1 * u, minNodeH));
    /* Label arrangement each column is planned for. */
    const planned: Arrangement[] = cols.map((col) =>
      col.length * (stackedH + labelGapY) <= innerH * stackedFill ? "stacked" : "inline",
    );
    // A label over its own ribbons reads best when it does not straddle
    // their edge: inside the band when the node is tall enough for it, and
    // beside the node when it is thin.
    const styleAt = (w: Work, k: number): LabelStyle => {
      const plan = planned[w.rank];
      if (!w.flowBehind || plan !== "stacked") return plan;
      const h = heightAt(w, k);
      if (h >= stackedH + 2 * u) return "stacked";
      if (h >= fs * 0.95) return "inline";
      // Thin node: a caption above it, clear of its own ribbons.
      return "above";
    };
    // How far a label reaches above and below the center of its node.
    const reach = (w: Work, style: LabelStyle, k: number): { up: number; down: number } => {
      if (w.side === "top") return { up: 0, down: 0 };
      const half = heightAt(w, k) / 2;
      if (style === "stacked") return { up: stackedH / 2, down: stackedH / 2 };
      if (style === "inline") return { up: inlineH / 2, down: inlineH / 2 };
      return { up: half + captionPad + w.rise + captionH, down: -(half + captionPad + w.rise) };
    };

    // One band at scale k. `t` (0..1) is how much of the room the detail
    // labels ask for they actually get; category labels always get theirs.
    const measureBand = (band: Band, k: number, t: number) => {
      const gapsIn: number[] = [];
      let span = 0;
      let up = 0;
      let down = 0;
      if (band.kids.length > 0) {
        const ext = band.kids.map((w) => reach(w, planned[w.rank], k));
        const hs = band.kids.map((w) => heightAt(w, k));
        const last = hs.length - 1;
        span = hs[0];
        for (let j = 1; j <= last; j++) {
          const need = ext[j - 1].down + ext[j].up + labelGapY - (hs[j - 1] + hs[j]) / 2;
          const sibling = eased(0.5 * u, siblingGap);
          const g = sibling + t * Math.max(0, need - sibling);
          gapsIn.push(g);
          span += g + hs[j];
        }
        up = span / 2 + t * Math.max(0, ext[0].up - hs[0] / 2);
        down = span / 2 + t * Math.max(0, ext[last].down - hs[last] / 2);
      }
      // upN/downN: where the band's nodes end; up/down: nodes and labels.
      let upN = span / 2;
      let downN = span / 2;
      let rise = 0;
      if (band.cat) {
        const half = heightAt(band.cat, k) / 2;
        const style = styleAt(band.cat, k);
        upN = Math.max(upN, half);
        downN = Math.max(downN, half);
        if (style === "above") {
          // The top ribbon climbs from the node to the first detail; the
          // caption gets room to sit above it.
          rise = Math.min(riseCap, Math.max(0, span / 2 - half));
          up = Math.max(up, half + captionPad + rise + captionH);
          down = Math.max(down, half);
        } else {
          const ext = reach(band.cat, style, k);
          up = Math.max(up, half, ext.up);
          down = Math.max(down, half, ext.down);
        }
      }
      return { up, down, upN, downN, span, gapsIn, rise };
    };
    const measureSide = (side: (typeof sides)[number], k: number, t: number) => {
      const bands = side.bands.map((band) => measureBand(band, k, t));
      const gaps: number[] = [];
      let total = 0;
      bands.forEach((m, i) => {
        total += m.up + m.down;
        if (i === 0) return;
        const prev = bands[i - 1];
        const apart = eased(
          bandLabelGap,
          side.bands[i].section !== side.bands[i - 1].section ? groupGap * 1.7 : groupGap,
        );
        // Nodes of neighboring bands keep `apart`; their labels at least a sliver.
        const g = Math.max(bandLabelGap, apart - (prev.down - prev.downN) - (m.up - m.upN));
        gaps.push(g);
        total += g;
      });
      return { bands, gaps, total };
    };
    const feasible = (k: number, t: number) =>
      k * maxColValue <= innerH + 0.01 && sides.every((side) => measureSide(side, k, t).total <= innerH + 0.01);
    /** Largest scale at which every band fits, or -1 when nothing does. */
    const fitScale = (t: number) => {
      const top = innerH / maxColValue;
      if (feasible(top, t)) return top;
      if (!feasible(0, t)) return -1;
      let lo = 0;
      let hi = top;
      for (let i = 0; i < 26; i++) {
        const mid = (lo + hi) / 2;
        if (feasible(mid, t)) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const planDetails = (plan: Arrangement) => {
      for (const r of detailRanks) planned[r] = plan;
    };

    const floor = (minFill * innerH) / maxColValue;
    let labelFit = 1;
    let scale: number;
    if (force) {
      planDetails(force);
      scale = fitScale(1);
    } else {
      const wantsStacked = compact || detailRanks.some((r) => planned[r] === "stacked");
      planDetails("inline");
      scale = fitScale(1);
      if (wantsStacked && detailRanks.length > 0) {
        planDetails("stacked");
        const stacked = fitScale(1);
        if (stacked >= floor && stacked >= stackedWorth * scale) scale = stacked;
        else planDetails("inline");
      }
      if (scale < floor) {
        // Even one-line labels would squeeze the nodes too thin: labels
        // give way, as few of them as possible.
        const bare = fitScale(0);
        if (bare <= floor) {
          // Not even bare nodes fit at a readable thickness: tighten the
          // gaps between them as far as needed.
          labelFit = 0;
          let lo = 0;
          let hi = 1;
          squeeze = 0;
          if (fitScale(0) >= floor) {
            for (let i = 0; i < 14; i++) {
              squeeze = (lo + hi) / 2;
              if (fitScale(0) >= floor) lo = squeeze;
              else hi = squeeze;
            }
            squeeze = lo;
          }
          scale = fitScale(0);
        } else {
          let lo = 0;
          let hi = 1;
          for (let i = 0; i < 14; i++) {
            const mid = (lo + hi) / 2;
            if (fitScale(mid) >= floor) lo = mid;
            else hi = mid;
          }
          labelFit = lo;
          scale = fitScale(lo);
        }
      }
    }
    return { innerH, planned, scale: Math.max(0, scale), labelFit, fits: scale >= 0, styleAt, reach, measureSide, heightAt };
  };

  if (probe) {
    probe(
      (innerH, force) => {
        const v = fitVertical(Math.max(20, innerH), force);
        return { scale: v.scale, labelFit: v.fits ? v.labelFit : 0, fill: (v.scale * maxColValue) / v.innerH };
      },
      { marginY, comfortFill, hasDetails: detailRanks.length > 0 },
    );
    return emptyLayout();
  }

  /* ── 2–5. Solve for a given top margin; the hub label may need more. ── */

  const solve = (marginTop: number) => {
    const marginBottom = marginY;
    const innerH = Math.max(20, height - marginTop - marginBottom);
    const { planned, scale, labelFit, styleAt, reach, measureSide, heightAt } = fitVertical(innerH);

    /* 2b. Place the bands, then whatever is left. */
    for (const w of work) w.drawH = heightAt(w, scale);
    const banded = new Set<number>();
    for (const side of sides) {
      const { bands, gaps, total } = measureSide(side, scale, labelFit);
      const gapSum = gaps.reduce((sum, g) => sum + g, 0);
      // Spare height opens the gaps between bands, within reason. A box too
      // short for even the tightest arrangement compresses it instead: bands
      // stay in order whatever happens.
      const grow = gapSum > 0 ? Math.max(1, Math.min(1.6, (innerH - (total - gapSum)) / gapSum)) : 1;
      const used = total - gapSum + gapSum * grow;
      const press = used > innerH ? innerH / used : 1;
      let y = press < 1 ? 0 : (innerH - used) / 2;
      side.bands.forEach((band, i) => {
        if (i > 0) y += gaps[i - 1] * grow;
        const m = bands[i];
        const center = (y + m.up) * press;
        if (band.cat) {
          band.cat.top = center - band.cat.drawH / 2;
          band.cat.rise = m.rise;
        }
        let ky = center - m.span / 2;
        band.kids.forEach((w, j) => {
          w.top = ky;
          ky += w.drawH + (m.gapsIn[j] ?? 0);
        });
        y += m.up + m.down;
      });
      banded.add(side.catRank);
      if (side.detRank !== null) banded.add(side.detRank);
    }
    const outward = cols.map((_, c) => c).sort((a, b) => Math.abs(a - hubRank) - Math.abs(b - hubRank));
    for (const c of outward) {
      if (banded.has(c)) continue;
      const col = cols[c];
      if (col.some((w) => w.parent)) {
        // A column further out than the bands reach: near its parents.
        const centers = spread(
          col.map((w, i) => ({
            target: w.parent ? w.parent.top + w.parent.drawH / 2 : innerH / 2,
            size: w.drawH,
            gap: i > 0 ? siblingGap : 0,
          })),
          0,
          innerH,
        );
        col.forEach((w, i) => (w.top = centers[i] - w.drawH / 2));
      } else {
        // The hub: centered.
        const nodesH = col.reduce((sum, w) => sum + w.drawH, 0);
        let y = (innerH - nodesH - groupGap * (col.length - 1)) / 2;
        for (const w of col) {
          w.top = y;
          y += w.drawH + groupGap;
        }
      }
    }

    // Hand positions back to d3-sankey, which stacks the links per node.
    for (const w of work) {
      const geomH = w.value * scale;
      w.node.y0 = marginTop + w.top + (w.drawH - geomH) / 2;
      w.node.y1 = w.node.y0 + geomH;
    }
    for (const l of wired.links) l.width = l.value * scale;
    generator.update(wired);

    /* 3. Labels: de-collide each column vertically. */
    const resolve = (col: Work[], styles: LabelStyle[]): Array<number | null> => {
      const result: Array<number | null> = col.map(() => null);
      let visible = col.map((_, i) => i);
      const lo = edgePad;
      const hi = height - edgePad;
      const ext = col.map((w, i) => reach(w, styles[i], scale));
      const sizeOf = (i: number) => ext[i].up + ext[i].down;
      const targetOf = (i: number) => marginTop + col[i].top + col[i].drawH / 2 + (ext[i].down - ext[i].up) / 2;
      // How far a label may drift from its place before it is dropped.
      const slack = (i: number) =>
        styles[i] === "stacked"
          ? Math.max(stackedH * 0.7, col[i].drawH / 2)
          : styles[i] === "inline"
            ? Math.max(inlineH, col[i].drawH / 2)
            : styles[i] === "above"
              ? inlineH * 0.4
              : 0;
      while (visible.length > 0) {
        const centers = spread(
          visible.map((i) => ({ target: targetOf(i), size: sizeOf(i), gap: labelGapY })),
          lo,
          hi,
        );
        const used = visible.reduce((sum, i) => sum + sizeOf(i), 0) + (visible.length - 1) * labelGapY;
        const fits = used <= hi - lo + 0.5;
        let worst = -1;
        let worstExcess = 0.5;
        visible.forEach((i, k) => {
          const excess = Math.abs(centers[k] - targetOf(i)) - slack(i);
          if (excess > worstExcess) {
            worstExcess = excess;
            worst = k;
          }
        });
        if (fits && worst < 0) {
          visible.forEach((i, k) => (result[i] = centers[k]));
          break;
        }
        // The crowd of touching labels around the worst one loses its
        // smallest member, then we try again.
        let a = worst < 0 ? 0 : worst;
        let b = worst < 0 ? visible.length - 1 : worst;
        const touching = (k: number) =>
          centers[k + 1] - centers[k] <= (sizeOf(visible[k]) + sizeOf(visible[k + 1])) / 2 + labelGapY + 0.5;
        while (a > 0 && touching(a - 1)) a--;
        while (b < visible.length - 1 && touching(b)) b++;
        if (a === b && fits) {
          // Alone and still displaced: it is pinned by the box edge. Keep it.
          visible.forEach((i, k) => (result[i] = centers[k]));
          break;
        }
        let drop = a;
        for (let k = a; k <= b; k++) if (col[visible[k]].value < col[visible[drop]].value) drop = k;
        visible = visible.filter((_, k) => k !== drop);
      }
      return result;
    };
    cols.forEach((col, c) => {
      if (c === hubRank) return;
      const count = (r: Array<number | null>) => r.filter((v) => v !== null).length;
      let styles = col.map((w) => styleAt(w, scale));
      let best = resolve(col, styles);
      if (planned[c] === "stacked" && count(best) < col.length) {
        const flat: LabelStyle[] = col.map(() => "inline");
        const alt = resolve(col, flat);
        if (count(alt) > count(best)) {
          best = alt;
          styles = flat;
        }
      }
      col.forEach((w, i) => {
        w.labelY = best[i];
        w.style = styles[i];
      });
    });
    const isShifted = (w: Work) =>
      w.labelY !== null &&
      w.style !== "above" &&
      Math.abs(w.labelY - (marginTop + w.top + w.drawH / 2)) > Math.max(w.drawH / 2, 2 * u) + 0.5;
    // A column with nudged labels moves them out a little, so the leader
    // lines from node to label are long enough to read.
    const offsetOf = cols.map((col) => labelOffset + (col.some(isShifted) ? leaderRun : 0));

    /* 4. Horizontal: margins and gaps from real label widths. */
    // Columns whose one-line labels lost their amount to make room.
    const nameOnly = cols.map(() => false);
    const oneLine = (w: Work) => w.style === "inline" || (w.style === "above" && !compact);
    const naturalW = (w: Work) =>
      !oneLine(w)
        ? Math.max(w.nameW, w.amountW)
        : nameOnly[w.rank]
          ? w.nameW
          : w.nameW + inlineGap + w.amountW;
    const floorW = (w: Work) =>
      !oneLine(w)
        ? Math.min(naturalW(w), Math.max(w.amountW, fs * 4.2))
        : Math.min(naturalW(w), (nameOnly[w.rank] ? 0 : w.amountW + inlineGap) + fs * 3.6);
    let need: number[] = [];
    let floor: number[] = [];
    const measureColumns = () => {
      const widest = (f: (w: Work) => number) =>
        cols.map((col, c) => col.reduce((m, w) => (w.labelY === null || c === hubRank ? m : Math.max(m, f(w))), 0));
      need = widest(naturalW);
      floor = widest(floorW);
    };
    measureColumns();
    // Region r: 0 = left margin, 1..columns-1 = gap before column r, columns = right margin.
    const regionOf = (c: number) => (c < hubRank ? c : c + 1);
    const regionCount = columns + 1;
    const regionLabelCol: Array<number | null> = new Array(regionCount).fill(null);
    for (let c = 0; c < columns; c++) {
      if (c !== hubRank && need[c] > 0) regionLabelCol[regionOf(c)] = c;
    }
    const isMargin = (r: number) => r === 0 || r === columns;
    const chrome = (r: number) => {
      const c = regionLabelCol[r];
      if (isMargin(r)) return c !== null ? offsetOf[c] + edgePad : edgePad;
      return c !== null ? offsetOf[c] + clearance : 0;
    };
    const minOf = (r: number) => {
      if (isMargin(r)) return 0;
      // Region r is the gap between columns r-1 and r.
      return r - 1 === hubRank || r === hubRank ? minHubGap : minGap;
    };
    const nodesW = colW.reduce((s, v) => s + v, 0);
    const sizeFor = (cap: number, gapScale: number) => {
      const sizes: number[] = [];
      for (let r = 0; r < regionCount; r++) {
        const c = regionLabelCol[r];
        const text = c === null ? 0 : Math.min(need[c], Math.max(floor[c], cap));
        sizes.push(Math.max(minOf(r) * gapScale, text + chrome(r)));
      }
      return sizes;
    };
    const total = (sizes: number[]) => sizes.reduce((s, v) => s + v, 0) + nodesW;
    let regions = sizeFor(Infinity, 1);
    if (total(regions) > width) {
      // Too narrow. Cap the widest labels first (they get an ellipsis).
      const capLabels = (gapScale: number) => {
        let lo = 0;
        let hi = Math.max(...need);
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (total(sizeFor(mid, gapScale)) <= width) lo = mid;
          else hi = mid;
        }
        return { sizes: sizeFor(lo, gapScale), cap: lo };
      };
      let fit = capLabels(1);
      regions = fit.sizes;
      // A one-line label squeezed to a stub of a name is worse than a
      // readable name alone: such columns drop the amount (still one tap
      // away) and the widths are worked out again.
      let dropped = false;
      cols.forEach((col, c) => {
        if (c === hubRank) return;
        const budget = regions[regionOf(c)] - chrome(regionOf(c));
        const cramped = col.some(
          (w) =>
            w.labelY !== null &&
            oneLine(w) &&
            budget - w.amountW - inlineGap < Math.min(w.nameW, fs * 5.5) - 0.5,
        );
        if (cramped) {
          nameOnly[c] = true;
          dropped = true;
        }
      });
      if (dropped) {
        measureColumns();
        regions = sizeFor(Infinity, 1);
        if (total(regions) > width) {
          fit = capLabels(1);
          regions = fit.sizes;
        } else {
          fit = { sizes: regions, cap: Infinity };
        }
      }
      // Names still cut to a few letters: the gaps give up some width too.
      if (fit.cap < fs * 5.5) regions = capLabels(0.72).sizes;
      // Last resort: everything shrinks in proportion.
      const over = total(regions) - width;
      if (over > 0) {
        const sum = regions.reduce((s, v) => s + v, 0);
        regions = regions.map((v) => v - (over * v) / sum);
      }
    } else {
      // Room to spare: share the gap space, a little more around the hub,
      // without ever going below what a gap's label needs.
      const weight = (r: number) => (r - 1 === hubRank || r === hubRank ? 1.25 : 1);
      const free = new Set<number>();
      for (let r = 1; r < columns; r++) free.add(r);
      let space = width - nodesW - regions[0] - regions[columns];
      for (let guard = 0; guard < columns; guard++) {
        let wsum = 0;
        for (const r of free) wsum += weight(r);
        let fixed = -1;
        for (const r of free) {
          if (regions[r] > (space * weight(r)) / wsum) {
            fixed = r;
            break;
          }
        }
        if (fixed < 0) {
          for (const r of free) regions[r] = (space * weight(r)) / wsum;
          break;
        }
        free.delete(fixed);
        space -= regions[fixed];
      }
    }
    const colX: number[] = [];
    let x = regions[0];
    for (let c = 0; c < columns; c++) {
      colX.push(x);
      x += colW[c] + (regions[c + 1] ?? 0);
    }
    const textBudget = cols.map((_, c) => (c === hubRank ? Infinity : Math.max(0, regions[regionOf(c)] - chrome(regionOf(c)))));

    /* 5. Ribbons. */
    const ribbons = wired.links.map((l) => {
      const s = workOf.get(l.source as SNode)!;
      const t = workOf.get(l.target as SNode)!;
      const w = Math.max(l.width ?? 0, minLinkW);
      const rb: Ribbon = {
        x0: colX[s.rank] + colW[s.rank] + linkGap,
        y0: l.y0 ?? 0,
        x1: colX[t.rank] - linkGap,
        y1: l.y1 ?? 0,
        width: w,
        comp: Math.min(w, 6 * u),
      };
      return { link: l, s, t, rb };
    });

    // Captions were given room for the steepest case; bring each back down
    // to just above where its own ribbons actually run beside it.
    for (const w of work) {
      if (w.style !== "above" || w.labelY === null || w.rise <= 0) continue;
      const nodeTop = marginTop + w.top;
      const reserved = nodeTop - captionPad - w.rise - captionH / 2;
      if (Math.abs(w.labelY - reserved) > 0.5) continue; // nudged by a neighbor: leave it
      const left = w.side === "left";
      const natural = compact
        ? Math.max(w.nameW, w.amountW)
        : w.nameW + (nameOnly[w.rank] ? 0 : inlineGap + w.amountW);
      const boxW = Math.min(natural, textBudget[w.rank]) + 2 * u;
      const near = left ? colX[w.rank] - offsetOf[w.rank] : colX[w.rank] + colW[w.rank] + offsetOf[w.rank];
      const far = left ? near - boxW : near + boxW;
      let top = nodeTop;
      for (const { s, t, rb } of ribbons) {
        if ((left ? t : s) !== w) continue;
        for (let i = 0; i <= 8; i++) top = Math.min(top, ribbonTopAt(rb, near + ((far - near) * i) / 8));
      }
      const rise = Math.min(w.rise, Math.max(0, nodeTop - top));
      w.labelY = nodeTop - captionPad - rise - captionH / 2;
    }

    /* Hub label: above the hub, lifted clear of the ribbons beside it. */
    const hub = work.find((w) => w.src.kind === "hub") ?? null;
    let hubLabel: { cx: number; bottom: number; width: number } | null = null;
    let overflowTop = 0;
    if (hub) {
      const lw = Math.max(hub.nameW, hub.amountW);
      const center = colX[hub.rank] + colW[hub.rank] / 2;
      const cx = Math.min(Math.max(center, edgePad + lw / 2), Math.max(edgePad + lw / 2, width - edgePad - lw / 2));
      const xa = cx - lw / 2 - 3 * u;
      const xb = cx + lw / 2 + 3 * u;
      let env = marginTop + hub.top;
      for (const { rb } of ribbons) {
        if (rb.x1 < xa || rb.x0 > xb) continue;
        const from = Math.max(xa, rb.x0);
        const to = Math.min(xb, rb.x1);
        for (let i = 0; i <= 6; i++) env = Math.min(env, ribbonTopAt(rb, from + ((to - from) * i) / 6));
      }
      for (const w of work) {
        if (w === hub) continue;
        const nx = colX[w.rank];
        if (nx + colW[w.rank] >= xa && nx <= xb) env = Math.min(env, marginTop + w.top);
      }
      const bottom = env - hubLabelGap;
      hubLabel = { cx, bottom, width: lw };
      overflowTop = Math.max(0, edgePad - (bottom - hubLabelH));
    }

    return { marginTop, marginBottom, scale, colX, textBudget, regions, ribbons, hub, hubLabel, overflowTop, offsetOf, nameOnly, isShifted };
  };

  let solved = solve(marginY);
  for (let i = 0; i < 3 && solved.overflowTop > 0.5; i++) {
    solved = solve(solved.marginTop + solved.overflowTop);
  }
  const { colX, textBudget, ribbons, hubLabel, offsetOf, nameOnly, isShifted } = solved;

  /* ── Assemble the result ── */

  const buildLabel = (w: Work): LayoutLabel | null => {
    if (w.src.kind === "hub") {
      if (!hubLabel) return null;
      const top = Math.max(edgePad, hubLabel.bottom - hubLabelH);
      const nameLine = hubNameFont.size * 1.3;
      const cx = hubLabel.cx;
      return {
        side: "top",
        arrangement: "stacked",
        anchor: "middle",
        x: r2(cx),
        y: r2(top + hubLabelH / 2),
        runs: hideAmounts
          ? [
              {
                role: "name",
                text: w.src.label,
                x: r2(cx),
                y: r2(top + hubAmountFont.size * 0.9),
                anchor: "middle",
                fontSize: hubAmountFont.size,
                fontWeight: hubAmountFont.weight,
              },
            ]
          : [
              {
                role: "name",
                text: w.src.label,
                x: r2(cx),
                y: r2(top + hubNameFont.size * 0.98),
                anchor: "middle",
                fontSize: hubNameFont.size,
                fontWeight: hubNameFont.weight,
              },
              {
                role: "amount",
                text: w.amountText,
                x: r2(cx),
                y: r2(top + nameLine + hubAmountFont.size * 0.9),
                anchor: "middle",
                fontSize: hubAmountFont.size,
                fontWeight: hubAmountFont.weight,
              },
            ],
        box: { x: r2(cx - hubLabel.width / 2), y: r2(top), width: r2(hubLabel.width), height: r2(hubLabelH) },
        truncated: false,
        halo: true,
        leader: null,
        prominent: true,
      };
    }
    if (w.labelY === null || w.side === "top") return null;
    const style = w.style;
    const budget = textBudget[w.rank];
    const left = w.side === "left";
    const anchor: TextAnchor = left ? "end" : "start";
    const nodeX = colX[w.rank];
    const offset = offsetOf[w.rank];
    const x = left ? nodeX - offset : nodeX + colW[w.rank] + offset;
    const cy = w.labelY;
    const nodeTop = solved.marginTop + w.top;
    const nodeCy = nodeTop + w.drawH / 2;
    const run = (role: "name" | "amount", text: string, rx: number, ry: number): LayoutTextRun => ({
      role,
      text,
      x: r2(rx),
      y: r2(ry),
      anchor,
      fontSize: role === "name" ? nameFont.size : amountFont.size,
      fontWeight: role === "name" ? nameFont.weight : amountFont.weight,
    });
    let runs: LayoutTextRun[];
    let boxW: number;
    let boxTop: number;
    let boxH: number;
    let truncated: boolean;
    const flat = style === "inline" || (style === "above" && !compact);
    if (flat) {
      const bare = nameOnly[w.rank];
      const tail = bare ? 0 : w.amountW + inlineGap;
      const name = truncateToWidth(w.src.label, Math.max(budget - tail, fs * 2), nameFont, measure);
      truncated = name.truncated;
      boxW = name.width + tail;
      boxH = inlineH;
      boxTop = cy - inlineH / 2;
      const baseline = cy + fs * 0.35;
      // Reading order is always name, then amount.
      runs = [run("name", name.text, left ? x - tail : x, baseline)];
      if (!bare) runs.push(run("amount", w.amountText, left ? x : x + name.width + inlineGap, baseline));
    } else {
      const name = truncateToWidth(w.src.label, Math.max(budget, fs * 2), nameFont, measure);
      truncated = name.truncated;
      boxW = Math.max(name.width, w.amountW);
      boxTop = cy - stackedH / 2;
      boxH = stackedH;
      runs = [
        run("name", name.text, x, boxTop + nameFont.size * 0.96),
        run("amount", w.amountText, x, boxTop + nameFont.size * 1.2 + amountFont.size * 0.97),
      ];
    }
    const shifted = isShifted(w);
    const outer = w.rank === 0 || w.rank === columns - 1;
    // Text that sits wholly inside its own node's band of ribbons is on one
    // flat color and needs no outline; anything else over ribbons does.
    const inside = w.flowBehind && (style === "stacked" || style === "inline") && boxTop >= nodeTop - 1.5 * u && boxTop + boxH <= nodeTop + w.drawH + 1.5 * u;
    return {
      side: w.side,
      arrangement: flat ? "inline" : "stacked",
      anchor,
      x: r2(x),
      y: r2(cy),
      runs,
      box: { x: r2(left ? x - boxW : x), y: r2(boxTop), width: r2(boxW), height: r2(boxH) },
      truncated,
      halo: !outer && !inside,
      leader: shifted
        ? {
            x1: r2(left ? nodeX - 1.5 * u : nodeX + colW[w.rank] + 1.5 * u),
            y1: r2(nodeCy),
            x2: r2(left ? x + 2.5 * u : x - 2.5 * u),
            y2: r2(cy),
          }
        : null,
      prominent: false,
    };
  };

  const nodes: LayoutNode[] = work.map((w) => ({
    id: w.src.id,
    name: w.src.label,
    kind: w.src.kind,
    group: w.src.group,
    column: w.rank,
    value: w.value,
    share: hubValue > 0 ? w.value / hubValue : 0,
    amountText: w.amountText,
    x: r2(colX[w.rank]),
    y: r2(solved.marginTop + w.top),
    width: r2(colW[w.rank]),
    height: r2(w.drawH),
    radius: r2(Math.min(nodeRadius, w.drawH / 2, colW[w.rank] / 2)),
    hatched: HATCHED_KINDS.has(w.src.kind),
    label: buildLabel(w),
  }));

  const links: LayoutLink[] = ribbons.map(({ link, s, t, rb }, index) => ({
    id: `${s.src.id}->${t.src.id}`,
    index,
    source: s.src.id,
    target: t.src.id,
    group: link.group,
    sourceGroup: s.src.group,
    targetGroup: t.src.group,
    value: link.value,
    share: hubValue > 0 ? link.value / hubValue : 0,
    column: s.rank,
    path: ribbonPath(rb),
    x0: r2(rb.x0),
    x1: r2(rb.x1),
    y0: r2(rb.y0),
    y1: r2(rb.y1),
    sourceWidth: r2(rb.width),
    targetWidth: r2(rb.width),
    hatched: HATCHED_KINDS.has(s.src.kind) || HATCHED_KINDS.has(t.src.kind),
  }));

  return {
    width,
    height,
    compact,
    hideAmounts,
    fontSize: fs,
    margin: {
      top: r2(solved.marginTop),
      right: r2(solved.regions[columns]),
      bottom: r2(solved.marginBottom),
      left: r2(solved.regions[0]),
    },
    columns,
    hubColumn: hubRank,
    columnX: colX.map(r2),
    columnWidth: colW.map(r2),
    scale: solved.scale,
    hubValue,
    amountFormat,
    nodes,
    links,
  };
}
