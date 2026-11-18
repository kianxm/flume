import { drawLogo, measureLogo } from "../brand";
import { formatMoney, formatPercent } from "./format";
import { computeLayout, idealLayoutHeight, type LayoutLink, type LayoutNode, type SankeyLayout } from "./layout";
import { getFlowColors, getRibbonStops } from "./palette";
import { UI_TOKENS, type UiTokens } from "./theme";
import type { ExportFormat, FlumeGraph, ThemeName } from "./types";

/**
 * PNG export, drawn directly on a <canvas> (rasterising an SVG through an
 * <img> drops web fonts and is unreliable on iOS Safari).
 *
 * The image is a finished graphic: page background, a header with the
 * title and a line of totals, the Flume logo opposite the title, and the
 * chart filling the rest. Chart geometry comes from the same
 * `computeLayout` the on-screen SVG uses, scaled up through `fontSize`, and
 * is painted with the same colors, opacities and label treatment as
 * components/sankey/SankeyChart.tsx.
 */

export interface ExportOptions {
  theme: ThemeName;
  /** "landscape" suits desktop sharing; "portrait" suits phones and stories. */
  format: ExportFormat;
  /** Show each flow as a percentage of income instead of an amount. */
  hideAmounts?: boolean;
  /** Device-pixel multiplier for the output. Defaults to 2. */
  scale?: number;
}

/** Logical (pre-scale) pixel size of each export format. */
export const EXPORT_SIZES: Record<ExportFormat, { width: number; height: number }> = {
  landscape: { width: 1600, height: 1000 },
  portrait: { width: 1080, height: 1350 },
};

/**
 * iOS Safari refuses canvases above 16,777,216 pixels (4096²) and fails
 * silently with a blank image; stay a little under it.
 */
export const MAX_EXPORT_PIXELS = 16_000_000;

/** Composition settings per format, in logical pixels. */
export interface ExportTuning {
  /** Outer padding on every side. */
  pad: number;
  /** Title size; shrinks (to 70%) and then truncates when the title is long. */
  titleSize: number;
  /** Totals line size. */
  totalsSize: number;
  /** Baseline-to-baseline distance from the title to the totals line. */
  totalsGap: number;
  /** Space between the header and the chart box. */
  headerGap: number;
  /** Chart label font size passed to `computeLayout`. */
  chartFontSize: number;
  /** Use the phone layout (thinner nodes, labels stacked longer). */
  compact: boolean;
  /** Height of the logo mark's square. */
  logoHeight: number;
  /**
   * The image may grow to this height when a full-detail chart needs more
   * room than the standard size gives it (otherwise its ribbons go thin).
   */
  maxHeight: number;
}

export const EXPORT_TUNING: Record<ExportFormat, ExportTuning> = {
  landscape: {
    pad: 64,
    titleSize: 50,
    totalsSize: 22,
    totalsGap: 44,
    headerGap: 36,
    chartFontSize: 18,
    compact: false,
    logoHeight: 44,
    maxHeight: 1280,
  },
  portrait: {
    pad: 56,
    titleSize: 46,
    totalsSize: 22,
    totalsGap: 42,
    headerGap: 32,
    chartFontSize: 22,
    compact: true,
    logoHeight: 40,
    maxHeight: 1350,
  },
};

/* ─────────────────────────────── Helpers ────────────────────────────── */

const FALLBACK_FAMILY = "ui-sans-serif, system-ui, sans-serif";

function pageFontFamily(): string {
  if (typeof document !== "undefined" && document.body) {
    const family = getComputedStyle(document.body).fontFamily;
    if (family) return family;
  }
  return FALLBACK_FAMILY;
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/**
 * Make sure every weight/size the image uses is loaded in the page font
 * before anything is measured or drawn; otherwise the first export after a
 * page load could silently come out in the fallback face. `sample` carries
 * the text to be drawn so faces split by unicode-range load too.
 */
async function ensureFonts(family: string, fonts: Array<{ size: number; weight: number }>, sample: string) {
  const set = typeof document !== "undefined" ? document.fonts : undefined;
  if (!set) return;
  await withTimeout(set.ready, 4000);
  const seen = new Set<string>();
  const loads: Promise<unknown>[] = [];
  for (const f of fonts) {
    const spec = `${f.weight} ${f.size}px ${family}`;
    if (seen.has(spec)) continue;
    seen.add(spec);
    loads.push(set.load(spec, sample));
  }
  await withTimeout(Promise.all(loads), 4000);
}

/** A rounded rectangle path; `ctx.roundRect` is missing on older Safari. */
function roundRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.arcTo(x + w, y, x + w, y + rr, rr);
  p.lineTo(x + w, y + h - rr);
  p.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  p.lineTo(x + rr, y + h);
  p.arcTo(x, y + h, x, y + h - rr, rr);
  p.lineTo(x, y + rr);
  p.arcTo(x, y, x + rr, y, rr);
  p.closePath();
  return p;
}

/* ───────────────────────────── Typesetting ──────────────────────────── */

type Align = "left" | "center" | "right";

interface DrawTextOptions {
  size: number;
  weight: number;
  color: string;
  align?: Align;
  /** Tabular figures: each digit centered in a cell of the tnum width. */
  tabular?: boolean;
  /** Extra space between characters, px (negative tightens). */
  tracking?: number;
  /** Background-colored outline painted under the glyphs. */
  halo?: { color: string; width: number };
}

/**
 * Canvas text in the page font. Canvas cannot switch on tabular figures
 * (Geist's default digits are proportional), so amounts are set digit by
 * digit, each centered in a cell as wide as the DOM's tabular digit. The
 * layout is measured the same way, so label positions stay exact.
 */
class Typesetter {
  private digitWidths = new Map<string, number>();
  private widths = new Map<string, number>();

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    readonly family: string,
  ) {}

  font(size: number, weight: number): string {
    return `${weight} ${size}px ${this.family}`;
  }

  /** Cap height of the font, for placing text by its visible top. */
  capHeight(size: number, weight: number): number {
    this.ctx.font = this.font(size, weight);
    const m = this.ctx.measureText("H");
    const a = m.actualBoundingBoxAscent;
    return a > 0 && Number.isFinite(a) ? a : size * 0.7;
  }

  /** Advance of one tabular digit, read from the DOM once per size/weight. */
  private digit(size: number, weight: number): number {
    const key = `${weight}/${size}`;
    let w = this.digitWidths.get(key);
    if (w !== undefined) return w;
    w = 0;
    if (typeof document !== "undefined" && document.body) {
      const probe = document.createElement("span");
      probe.textContent = "0123456789";
      probe.style.cssText =
        `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;` +
        `font:${weight} ${size}px ${this.family};font-variant-numeric:tabular-nums;letter-spacing:0`;
      document.body.appendChild(probe);
      w = probe.getBoundingClientRect().width / 10;
      probe.remove();
    }
    if (!(w > 0)) {
      this.ctx.font = this.font(size, weight);
      for (const d of "0123456789") w = Math.max(w, this.ctx.measureText(d).width);
    }
    this.digitWidths.set(key, w);
    return w;
  }

  private pieces(text: string, size: number, weight: number, tabular: boolean, tracking: number) {
    const ctx = this.ctx;
    ctx.font = this.font(size, weight);
    if (!tracking && !(tabular && /\d/.test(text))) {
      return { pieces: [{ text, dx: 0 }], width: ctx.measureText(text).width };
    }
    const tokens = tracking ? Array.from(text) : (text.match(/\d|\D+/g) ?? []);
    const cell = tabular ? this.digit(size, weight) : 0;
    ctx.font = this.font(size, weight);
    const out: Array<{ text: string; dx: number }> = [];
    let x = 0;
    tokens.forEach((tok, i) => {
      if (i > 0) x += tracking;
      if (tabular && tok >= "0" && tok <= "9" && tok.length === 1) {
        const g = ctx.measureText(tok).width;
        out.push({ text: tok, dx: x + (cell - g) / 2 });
        x += cell;
      } else {
        out.push({ text: tok, dx: x });
        x += ctx.measureText(tok).width;
      }
    });
    return { pieces: out, width: x };
  }

  measure(text: string, size: number, weight: number, tabular = false, tracking = 0): number {
    const key = `${tabular ? "t" : "p"}${weight}/${size}/${tracking}/${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      w = this.pieces(text, size, weight, tabular, tracking).width;
      this.widths.set(key, w);
    }
    return w;
  }

  /** Draws `text` with its alphabetic baseline at y. Returns its width. */
  draw(text: string, x: number, y: number, o: DrawTextOptions): number {
    const ctx = this.ctx;
    const { pieces, width } = this.pieces(text, o.size, o.weight, !!o.tabular, o.tracking ?? 0);
    const left = o.align === "right" ? x - width : o.align === "center" ? x - width / 2 : x;
    ctx.font = this.font(o.size, o.weight);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (o.halo) {
      ctx.lineJoin = "round";
      ctx.lineWidth = o.halo.width;
      ctx.strokeStyle = o.halo.color;
      for (const p of pieces) ctx.strokeText(p.text, left + p.dx, y);
    }
    ctx.fillStyle = o.color;
    for (const p of pieces) ctx.fillText(p.text, left + p.dx, y);
    return width;
  }

  /** `text`, shortened with an ellipsis until it fits `max`. */
  fit(text: string, max: number, size: number, weight: number, tracking = 0): string {
    if (this.measure(text, size, weight, false, tracking) <= max) return text;
    const chars = Array.from(text);
    let lo = 1;
    let hi = chars.length - 1;
    const cut = (n: number) => chars.slice(0, n).join("").trimEnd() + "…";
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(cut(mid), size, weight, false, tracking) <= max) lo = mid;
      else hi = mid - 1;
    }
    return cut(Math.max(1, lo));
  }
}

/* ─────────────────────────────── Totals ─────────────────────────────── */

export interface TotalItem {
  label: string;
  value: string;
}

/**
 * The header's totals: money, or (hiding amounts) shares of income with no
 * money anywhere. Zero savings and a zero remainder are left out.
 */
export function exportTotals(graph: FlumeGraph, hideAmounts: boolean): TotalItem[] {
  const t = graph.totals;
  const items: TotalItem[] = [];
  if (hideAmounts) {
    if (!(t.income > 0)) return items;
    items.push({ label: "Spent", value: formatPercent(t.expenses, t.income) });
    if (t.savings > 0) items.push({ label: "Saved", value: formatPercent(t.savings, t.income) });
    if (t.surplus > 0) items.push({ label: "Left over", value: formatPercent(t.surplus, t.income) });
    if (t.shortfall > 0) items.push({ label: "Shortfall", value: formatPercent(t.shortfall, t.income) });
    return items;
  }
  const money = (v: number) => formatMoney(v, graph.currency);
  items.push({ label: "Income", value: money(t.income) });
  items.push({ label: "Spent", value: money(t.expenses) });
  if (t.savings > 0) items.push({ label: "Saved", value: money(t.savings) });
  if (t.surplus > 0) items.push({ label: "Left over", value: money(t.surplus) });
  if (t.shortfall > 0) items.push({ label: "Shortfall", value: money(t.shortfall) });
  return items;
}

/* ──────────────────────────────── Chart ─────────────────────────────── */

/**
 * The "Left over" / "From savings" fill: a pale tint of the color with
 * 45° stripes, the SVG pattern's geometry (period fs/2, stripe 0.15·fs,
 * rotated −45°) drawn as clipped strokes so it stays crisp at any scale.
 */
function fillHatched(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  bounds: { x: number; y: number; w: number; h: number },
  color: string,
  theme: ThemeName,
  fs: number,
) {
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = rgba(color, theme === "dark" ? 0.2 : 0.16);
  ctx.fill(path);
  const period = fs * 0.5;
  const stripe = fs * 0.15;
  // Stripes are the lines x + y = c, `period` apart measured across them.
  const step = period * Math.SQRT2;
  const phase = (stripe / 2) * Math.SQRT2;
  const y0 = bounds.y - 2;
  const y1 = bounds.y + bounds.h + 2;
  const c0 = bounds.x + y0 - stripe * 2;
  const c1 = bounds.x + bounds.w + y1 + stripe * 2;
  ctx.beginPath();
  for (let k = Math.floor(c0 / step); k * step <= c1; k++) {
    const c = k * step + phase;
    ctx.moveTo(c - y0, y0);
    ctx.lineTo(c - y1, y1);
  }
  ctx.strokeStyle = rgba(color, 0.5);
  ctx.lineWidth = stripe;
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.restore();
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  type: Typesetter,
  graph: FlumeGraph,
  layout: SankeyLayout,
  theme: ThemeName,
  ui: UiTokens,
) {
  const colors = getFlowColors(graph, theme);
  const fs = layout.fontSize;
  const u = fs / (layout.compact ? 11 : 13);

  /* Ribbons, by source column like the SVG. */
  const columns = [...new Set(layout.links.map((l) => l.column))].sort((a, b) => a - b);
  for (const c of columns) {
    for (const l of layout.links) {
      if (l.column !== c) continue;
      drawRibbon(ctx, l, colors, theme, fs);
    }
  }

  /* Nodes. */
  for (const n of layout.nodes) drawNode(ctx, n, colors, theme, fs, u, ui);

  /* Leaders, then labels. */
  ctx.save();
  ctx.strokeStyle = rgba(ui.textFaint, 0.9);
  ctx.lineWidth = u;
  ctx.lineCap = "round";
  for (const n of layout.nodes) {
    const ld = n.label?.leader;
    if (!ld) continue;
    ctx.beginPath();
    ctx.moveTo(ld.x1, ld.y1);
    ctx.lineTo(ld.x2, ld.y2);
    ctx.stroke();
  }
  ctx.restore();

  for (const n of layout.nodes) {
    const label = n.label;
    if (!label) continue;
    for (const run of label.runs) {
      const amount = run.role === "amount";
      // Names are ink, amounts muted; the hub flips that (small muted name
      // over a large amount) unless its name stands alone.
      const ink = label.prominent ? amount || label.runs.length === 1 : !amount;
      const color = ink ? ui.text : ui.textMuted;
      type.draw(run.text, run.x, run.y, {
        size: run.fontSize,
        weight: run.fontWeight,
        color,
        align: run.anchor === "end" ? "right" : run.anchor === "middle" ? "center" : "left",
        tabular: amount,
        tracking: label.prominent && run.fontSize > fs ? -0.02 * run.fontSize : 0,
        halo: label.halo ? { color: rgba(ui.bg, 0.82), width: Math.max(2 * u, run.fontSize * 0.22) } : undefined,
      });
    }
  }
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  l: LayoutLink,
  colors: Record<string, string>,
  theme: ThemeName,
  fs: number,
) {
  let path: Path2D;
  try {
    path = new Path2D(l.path);
  } catch {
    return;
  }
  if (l.hatched) {
    const w = Math.max(l.sourceWidth, l.targetWidth);
    const top = Math.min(l.y0, l.y1) - w * 2 - 4;
    const bottom = Math.max(l.y0, l.y1) + w * 2 + 4;
    fillHatched(ctx, path, { x: l.x0 - 2, y: top, w: l.x1 - l.x0 + 4, h: bottom - top }, colors[l.group] ?? "#888888", theme, fs);
    return;
  }
  const [a, b] = getRibbonStops(l.sourceGroup, l.targetGroup, colors, theme);
  const x1 = l.x1 > l.x0 ? l.x1 : l.x0 + 1;
  const g = ctx.createLinearGradient(l.x0, 0, x1, 0);
  g.addColorStop(a.offset, rgba(a.color, a.opacity));
  g.addColorStop(b.offset, rgba(b.color, b.opacity));
  ctx.fillStyle = g;
  ctx.fill(path);
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  n: LayoutNode,
  colors: Record<string, string>,
  theme: ThemeName,
  fs: number,
  u: number,
  ui: UiTokens,
) {
  const color = colors[n.group] ?? ui.textFaint;
  if (!(n.width > 0) || !(n.height > 0)) return;
  if (n.hatched) {
    // Like the SVG: inset by half the outline so the stroke stays inside.
    const inset = 0.5 * u;
    const w = Math.max(0, n.width - 2 * inset);
    const h = Math.max(0, n.height - 2 * inset);
    const p = roundRectPath(n.x + inset, n.y + inset, w, h, n.radius);
    fillHatched(ctx, p, { x: n.x, y: n.y, w: n.width, h: n.height }, color, theme, fs);
    ctx.strokeStyle = color;
    ctx.lineWidth = u;
    ctx.stroke(p);
    return;
  }
  ctx.fillStyle = color;
  ctx.fill(roundRectPath(n.x, n.y, n.width, n.height, n.radius));
}

/* ─────────────────────────────── Compose ────────────────────────────── */

function textOf(graph: FlumeGraph): string {
  const parts = [graph.title ?? "", "Flume Income Spent Saved Left over Shortfall 0123456789$,.%…·<>"];
  for (const n of graph.nodes) parts.push(n.label);
  return parts.join(" ");
}

/** The scale actually used: the requested one, shrunk to fit iOS's canvas limit. */
export function exportScale(format: ExportFormat, requested?: number, logicalHeight?: number): number {
  const { width, height: standard } = EXPORT_SIZES[format];
  const height = logicalHeight ?? standard;
  const want = requested && Number.isFinite(requested) && requested > 0 ? requested : 2;
  const max = Math.sqrt(MAX_EXPORT_PIXELS / (width * height));
  return Math.min(want, max);
}

/**
 * Draws the export onto a new canvas and returns it. `exportPng` encodes it;
 * the dev page can pass `tuning` overrides to compare compositions.
 */
export async function renderExportCanvas(
  graph: FlumeGraph,
  opts: ExportOptions,
  tuning: Partial<ExportTuning> = {},
  /** Internal: the taller second pass passes the height it settled on. */
  heightOverride?: number,
): Promise<HTMLCanvasElement> {
  const format: ExportFormat = opts.format === "portrait" ? "portrait" : "landscape";
  const theme: ThemeName = opts.theme === "dark" ? "dark" : "light";
  const hideAmounts = !!opts.hideAmounts;
  const spec: ExportTuning = { ...EXPORT_TUNING[format], ...tuning };
  const W = EXPORT_SIZES[format].width;
  const H = heightOverride ?? EXPORT_SIZES[format].height;
  const ui = UI_TOKENS[theme];
  const family = pageFontFamily();

  // Every face the image uses: the layout's label fonts, header, wordmark.
  const fs = spec.chartFontSize;
  const labelU = fs / (spec.compact ? 11 : 13);
  await ensureFonts(
    family,
    [
      { size: fs, weight: 500 },
      { size: Math.round((fs - labelU) * 2) / 2, weight: 400 },
      { size: Math.round(fs * (spec.compact ? 1.5 : 1.7)), weight: 600 },
      { size: spec.titleSize, weight: 600 },
      { size: spec.totalsSize, weight: 400 },
      { size: spec.totalsSize, weight: 600 },
      { size: spec.logoHeight * 0.78, weight: 600 },
    ],
    textOf(graph),
  );

  const scale = exportScale(format, opts.scale, H);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(W * scale));
  canvas.height = Math.max(1, Math.floor(H * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not create the image.");
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.imageSmoothingQuality = "high";
  const type = new Typesetter(ctx, family);

  /* Background. */
  ctx.fillStyle = ui.bg;
  ctx.fillRect(0, 0, W, H);

  /* Header. */
  const pad = spec.pad;
  const contentW = W - 2 * pad;
  const logoH = spec.logoHeight;
  const logoW = measureLogo(ctx, { height: logoH, withWordmark: true, fontFamily: family }).width;
  const logoGap = logoH;
  const besideLogo = contentW - logoW - logoGap;

  const title = graph.title?.trim() ?? "";
  const titleTracking = (size: number) => -0.025 * size;
  let firstCap = 0;
  let baseline = pad;
  if (title) {
    // Long titles first shrink a little, then wrap to a second line, and
    // only then lose their end to an ellipsis.
    const width = (text: string, s: number) => type.measure(text, s, 600, false, titleTracking(s));
    let size = spec.titleSize;
    const min = Math.round(spec.titleSize * 0.85);
    while (size > min && width(title, size) > besideLogo) size -= 1;
    const lines = [title];
    if (width(title, size) > besideLogo) {
      const words = title.split(/\s+/);
      let n = 1;
      while (n < words.length && width(words.slice(0, n + 1).join(" "), size) <= besideLogo) n++;
      lines.splice(0, 1, words.slice(0, n).join(" "), words.slice(n).join(" "));
      if (!lines[1]) lines.pop();
    }
    firstCap = type.capHeight(size, 600);
    baseline = pad + firstCap;
    lines.forEach((line, i) => {
      if (i > 0) baseline += size * 1.12;
      const text = type.fit(line, besideLogo, size, 600, titleTracking(size));
      type.draw(text, pad, baseline, { size, weight: 600, color: ui.text, tracking: titleTracking(size) });
    });
  }

  const items = exportTotals(graph, hideAmounts);
  const ts = spec.totalsSize;
  const totalsCap = type.capHeight(ts, 400);
  let headerBottom = title ? baseline + spec.titleSize * 0.22 : pad;
  if (items.length) {
    let y = title ? baseline + spec.totalsGap : pad + totalsCap;
    if (!title) firstCap = totalsCap;
    const logoBottom = pad + firstCap / 2 + logoH / 2;
    const sep = ts * 1.5;
    const itemW = (it: TotalItem) =>
      type.measure(it.label, ts, 400) + ts * 0.35 + type.measure(it.value, ts, 600, true);
    // Greedy wrap between items, never inside one.
    const lines: TotalItem[][] = [[]];
    let lineW = 0;
    for (const it of items) {
      const w = itemW(it);
      const room = y - totalsCap > logoBottom + 4 || lines.length > 1 ? contentW : besideLogo;
      const cur = lines[lines.length - 1];
      if (cur.length && lineW + sep + w > room) {
        lines.push([it]);
        lineW = w;
      } else {
        lineW += (cur.length ? sep : 0) + w;
        cur.push(it);
      }
    }
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) y += ts * 1.5;
      let x = pad;
      lines[i].forEach((it, k) => {
        if (k > 0) {
          type.draw("·", x + sep / 2, y, { size: ts, weight: 600, color: ui.textFaint, align: "center" });
          x += sep;
        }
        x += type.draw(it.label, x, y, { size: ts, weight: 400, color: ui.textMuted });
        x += ts * 0.35;
        x += type.draw(it.value, x, y, { size: ts, weight: 600, color: ui.text, tabular: true });
      });
    }
    headerBottom = y + ts * 0.25;
  }

  /* Logo: top right, centered on the first header line's capitals. */
  if (!firstCap) firstCap = totalsCap;
  const logoY = pad + firstCap / 2 - logoH / 2;
  drawLogo(ctx, { x: W - pad - logoW, y: logoY, height: logoH, theme, withWordmark: true, fontFamily: family });
  headerBottom = Math.max(headerBottom, logoY + logoH);

  /* Chart. */
  const chartTop = headerBottom + spec.headerGap;
  const chartH = Math.max(40, H - pad - chartTop);
  // A full-detail chart needs a certain height before every category and its
  // details sit in a level band at a comfortable thickness. When the standard
  // size falls short, draw again on a taller image (up to `maxHeight`).
  if (heightOverride === undefined && spec.maxHeight > H) {
    const ideal = idealLayoutHeight(graph, { compact: spec.compact, fontSize: fs });
    const taller = Math.min(spec.maxHeight, Math.ceil(H + ideal - chartH));
    if (taller > H + 8) return renderExportCanvas(graph, opts, tuning, taller);
  }
  const layout = computeLayout(graph, {
    width: contentW,
    height: chartH,
    compact: spec.compact,
    fontSize: fs,
    hideAmounts,
    measureText: (text, font) => type.measure(text, font.size, font.weight, !!font.tabular),
  });
  ctx.save();
  ctx.translate(pad, chartTop);
  // Nothing flows (no data, or a lone hub): a quiet note, not a stray bar.
  if (layout.nodes.length === 0 || layout.links.length === 0) {
    type.draw("Nothing to show yet", contentW / 2, chartH / 2, {
      size: fs,
      weight: 500,
      color: ui.textFaint,
      align: "center",
    });
  } else {
    drawChart(ctx, type, graph, layout, theme, ui);
  }
  ctx.restore();

  return canvas;
}

function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(",", 2);
  const type = /data:([^;,]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** PNG bytes of a canvas: `toBlob`, else a data-URL round trip. */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const fallback = () => {
      try {
        const url = canvas.toDataURL("image/png");
        if (!url.startsWith("data:image/png")) throw new Error("This browser could not encode the image.");
        resolve(dataUrlToBlob(url));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("This browser could not encode the image."));
      }
    };
    if (typeof canvas.toBlob !== "function") {
      fallback();
      return;
    }
    try {
      canvas.toBlob((blob) => (blob && blob.size > 0 ? resolve(blob) : fallback()), "image/png");
    } catch {
      fallback();
    }
  });
}

/** Renders the chart, title, totals and the Flume logo to a PNG. */
export async function exportPng(graph: FlumeGraph, opts: ExportOptions): Promise<Blob> {
  const canvas = await renderExportCanvas(graph, opts);
  try {
    return await canvasToPng(canvas);
  } finally {
    // iOS caps total canvas memory; give this one back right away.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** e.g. "flume-october-2026.png" */
export function exportFileName(graph: FlumeGraph): string {
  const slug = (graph.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `flume-${slug}.png` : "flume.png";
}

/** True where the primary pointer is a finger (phones, tablets). */
function primaryInputIsTouch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking at once can cancel the download in Safari and Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Hands the PNG to the user: the native share sheet on touch devices that
 * can share files (so it can go straight to Photos or a chat), otherwise a
 * normal download.
 */
export async function saveImage(
  blob: Blob,
  fileName: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
  if (primaryInputIsTouch() && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    let file: File | null = null;
    try {
      file = new File([blob], fileName, { type: blob.type || "image/png" });
    } catch {
      file = null;
    }
    let canShare = false;
    try {
      canShare = !!file && !!navigator.canShare?.({ files: [file] });
    } catch {
      canShare = false;
    }
    if (file && canShare) {
      try {
        await navigator.share({ files: [file] });
        return "shared";
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return "cancelled";
        // NotAllowedError (the tap's user activation expired) and anything
        // else: fall back to a download below.
      }
    }
  }
  download(blob, fileName);
  return "downloaded";
}
