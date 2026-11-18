import { UI_TOKENS } from "./flume/theme";
import type { ThemeName } from "./flume/types";

/**
 * The Flume logo, as geometry shared by the React components
 * (components/brand/Logo.tsx), the favicon/app icons and the canvas export.
 *
 * The mark is an "F" drawn in the chart's own language: the stem is a Sankey
 * node, the top arm leaves it through a channel-like bend (the flume), and
 * the middle arm is a Sankey link that flows down and to the right. Two pieces, so it can be rendered two-tone (body in the text
 * color, flow in the accent) or in one flat color.
 *
 * Both paths live in a MARK_VIEWBOX × MARK_VIEWBOX square. Draw FLOW first
 * and BODY second: the flow tucks 0.5 units under the stem so there is never
 * a hairline seam between them.
 */
export const MARK_VIEWBOX = 32;

/** Stem and top arm: one shape with a rounded outer bend and a round foot. */
export const MARK_BODY_PATH =
  "M10.75 2H29V9H11.5A1.75 1.75 0 0 0 9.75 10.75V27A3 3 0 0 1 3.75 27V9A7 7 0 0 1 10.75 2Z";

/** Middle arm: a Sankey link leaving the stem and settling lower. */
export const MARK_FLOW_PATH =
  "M9.25 12C18.5 12 18.5 17.25 27.75 17.25L27.75 23.25C18.5 23.25 18.5 18 9.25 18Z";

/** Wordmark settings, as multiples of the mark height. */
export const WORDMARK = {
  text: "Flume",
  /** Font size relative to the mark height. */
  fontSize: 0.78,
  fontWeight: 600,
  /** Letter spacing in em. */
  letterSpacing: -0.035,
  /** Space between mark and wordmark relative to the mark height. */
  gap: 0.28,
} as const;

export interface LogoDrawOptions {
  /** Left edge of the logo. */
  x: number;
  /** Top edge of the logo (top of the mark's square). */
  y: number;
  /** Height of the mark's square, in canvas units. */
  height: number;
  theme: ThemeName;
  /** Also draw "Flume" to the right of the mark. Default false. */
  withWordmark?: boolean;
  /**
   * CSS font-family for the wordmark. Defaults to the page body's resolved
   * family (Geist via next/font), falling back to a system sans.
   */
  fontFamily?: string;
}

const FALLBACK_FAMILY = "ui-sans-serif, system-ui, sans-serif";

function resolveFamily(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof document !== "undefined" && document.body) {
    const family = getComputedStyle(document.body).fontFamily;
    if (family) return family;
  }
  return FALLBACK_FAMILY;
}

function wordmarkFont(height: number, family: string): string {
  return `${WORDMARK.fontWeight} ${height * WORDMARK.fontSize}px ${family}`;
}

/**
 * Turn on native canvas letter spacing when the browser has it (it matches
 * CSS letter-spacing exactly). Returns false when unsupported.
 */
function setTracking(ctx: CanvasRenderingContext2D, spacing: number): boolean {
  if (!("letterSpacing" in ctx)) return false;
  ctx.letterSpacing = `${spacing}px`;
  return true;
}

/** Ink advance of `text` with letter spacing (no trailing space). */
function trackedWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  spacing: number,
  native: boolean,
) {
  // Native tracking adds the spacing after every glyph, the last included.
  const w = ctx.measureText(text).width;
  return native ? w - spacing : w + spacing * (text.length - 1);
}

/** Total width drawLogo would use, without drawing anything. */
export function measureLogo(
  ctx: CanvasRenderingContext2D,
  opts: Pick<LogoDrawOptions, "height" | "withWordmark" | "fontFamily">,
): { width: number } {
  const { height, withWordmark = false } = opts;
  if (!withWordmark) return { width: height };
  ctx.save();
  ctx.font = wordmarkFont(height, resolveFamily(opts.fontFamily));
  const spacing = height * WORDMARK.fontSize * WORDMARK.letterSpacing;
  const native = setTracking(ctx, spacing);
  const text = trackedWidth(ctx, WORDMARK.text, spacing, native);
  ctx.restore();
  return { width: height + height * WORDMARK.gap + text };
}

let bodyPath: Path2D | null = null;
let flowPath: Path2D | null = null;

/**
 * Draw the logo with its top-left at (x, y), the mark `height` tall.
 * Returns the total drawn width so callers can place things beside it.
 */
export function drawLogo(
  ctx: CanvasRenderingContext2D,
  opts: LogoDrawOptions,
): { width: number } {
  const { x, y, height, theme, withWordmark = false } = opts;
  const tokens = UI_TOKENS[theme];
  bodyPath ??= new Path2D(MARK_BODY_PATH);
  flowPath ??= new Path2D(MARK_FLOW_PATH);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(height / MARK_VIEWBOX, height / MARK_VIEWBOX);
  ctx.fillStyle = tokens.accent;
  ctx.fill(flowPath);
  ctx.fillStyle = tokens.text;
  ctx.fill(bodyPath);
  ctx.restore();

  if (!withWordmark) return { width: height };

  const fontSize = height * WORDMARK.fontSize;
  const spacing = fontSize * WORDMARK.letterSpacing;
  const text = WORDMARK.text;

  ctx.save();
  ctx.font = wordmarkFont(height, resolveFamily(opts.fontFamily));
  ctx.fillStyle = tokens.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // Same vertical placement as the HTML wordmark: a line box of 1em centred
  // on the mark, with the glyphs centred in it by their ascent and descent.
  const m = ctx.measureText(text);
  const baseline =
    y + height / 2 + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
  const left = x + height + height * WORDMARK.gap;
  const native = setTracking(ctx, spacing);
  if (native) {
    ctx.fillText(text, left, baseline);
  } else {
    // Glyph by glyph, keeping kerning: each glyph sits where the kerned
    // prefix ends, plus the accumulated spacing.
    for (let i = 0; i < text.length; i++) {
      const prefix = i === 0 ? 0 : ctx.measureText(text.slice(0, i)).width;
      ctx.fillText(text[i], left + prefix + spacing * i, baseline);
    }
  }
  const width =
    height + height * WORDMARK.gap + trackedWidth(ctx, text, spacing, native);
  ctx.restore();
  return { width };
}
