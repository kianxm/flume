"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatMoney, formatPercent } from "@/lib/flume/format";
import {
  computeLayout,
  formatFlowAmount,
  idealLayoutHeight,
  type LayoutLabel,
  type LayoutLink,
  type LayoutNode,
  type MeasureText,
  type SankeyLayout,
} from "@/lib/flume/layout";
import { getFlowColors, getRibbonStops } from "@/lib/flume/palette";
import { UI_TOKENS } from "@/lib/flume/theme";
import type { FlumeGraph } from "@/lib/flume/types";
import { useTheme } from "@/lib/use-theme";

export interface SankeyChartProps {
  graph: FlumeGraph;
  /** Privacy mode: percentages of the hub instead of money amounts. */
  hideAmounts?: boolean;
  className?: string;
  /** Change it to replay the entrance animation. */
  animateKey?: string | number;
  /** Called once, after the chart has been measured and first drawn. */
  onReady?: () => void;
}

/** Below this container width the chart switches to its phone layout. */
export const SANKEY_COMPACT_BELOW = 640;

/* ───────────────────────────── Sizing ───────────────────────────── */

/** Rows in the busiest column (a category with details counts once per detail). */
export function sankeyBusiestRows(graph: FlumeGraph): number {
  const perColumn = new Map<number, number>();
  for (const n of graph.nodes) perColumn.set(n.column, (perColumn.get(n.column) ?? 0) + 1);
  const children = new Map<string, number>();
  const col = new Map(graph.nodes.map((n) => [n.id, n.column]));
  for (const l of graph.links) {
    const s = col.get(l.source) ?? 0;
    const t = col.get(l.target) ?? 0;
    if (t > graph.hubColumn + 1) children.set(l.source, (children.get(l.source) ?? 0) + 1);
    if (s < graph.hubColumn - 1) children.set(l.target, (children.get(l.target) ?? 0) + 1);
  }
  const rows = (column: number) =>
    graph.nodes.filter((n) => n.column === column).reduce((sum, n) => sum + Math.max(1, children.get(n.id) ?? 0), 0);
  return Math.max(1, ...perColumn.values(), rows(graph.hubColumn - 1), rows(graph.hubColumn + 1));
}

const idealCache = new WeakMap<FlumeGraph, Map<string, number>>();
/** `idealLayoutHeight`, remembered per graph: resizes ask for it repeatedly. */
function idealHeight(graph: FlumeGraph, compact: boolean, oneLine: boolean): number {
  let perGraph = idealCache.get(graph);
  if (!perGraph) idealCache.set(graph, (perGraph = new Map()));
  const key = `${compact}/${oneLine}`;
  let h = perGraph.get(key);
  if (h === undefined) perGraph.set(key, (h = idealLayoutHeight(graph, { compact, oneLine })));
  return h;
}

/**
 * Chart height for a container width.
 *
 * Full detail: what the layout needs to give every category and its details
 * a level band with all labels showing (`idealLayoutHeight`), even when that
 * is taller than the viewport; the page scrolls. Without detail columns:
 * 16:10 on wide screens (less for a handful of nodes, never taller than the
 * viewport allows), a label-high row per node on phones.
 */
export function pickSankeyHeight(graph: FlumeGraph, width: number, viewportHeight: number): number {
  const busiest = sankeyBusiestRows(graph);
  if (width < SANKEY_COMPACT_BELOW) {
    const ideal = idealHeight(graph, true, false);
    if (ideal > 0) {
      // Two-line detail labels are narrow, which is what a phone needs; use
      // them while that keeps the chart to about twice its width.
      if (ideal <= width * 2.05) return Math.round(Math.max(ideal, width * 1.1));
      return Math.round(Math.max(width * 1.3, Math.min(idealHeight(graph, true, true), 1500)));
    }
    const stacked = busiest * 31 + 40;
    if (stacked <= width * 2.05) return Math.round(Math.max(stacked, width * 1.1));
    return Math.round(Math.max(width * 1.3, Math.min(busiest * 19.5 + 60, 1500)));
  }
  const cap = Math.max(420, viewportHeight - 120);
  // A handful of nodes does not need the full 16:10: keep the bars sane.
  const roomy = busiest * 104 + 150;
  const base = Math.max(360, Math.min(Math.max(Math.min(width / 1.6, roomy), busiest * 22 + 80), cap));
  // Detail columns set their own floor, viewport or not (but not absurdly tall).
  const ideal = Math.min(idealHeight(graph, false, false), width * 1.5);
  return Math.round(Math.max(base, ideal));
}

/* ─────────────────────────── Environment ─────────────────────────── */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getReduced = () => window.matchMedia(REDUCED_QUERY).matches;
const getReducedServer = () => false;

/**
 * Text widths from a canvas, in the chart's real font. Amounts are drawn in
 * tabular figures, which a canvas cannot switch on, so the width of one
 * tabular digit is read from the DOM once per size and weight.
 */
function createMeasurer(host: HTMLElement, fontFamily: string): MeasureText | undefined {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return undefined;
  const cache = new Map<string, number>();
  const digit = new Map<string, number>();
  const plain = (text: string, size: number, weight: number) => {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
  const digitWidth = (size: number, weight: number) => {
    const key = `${weight}/${size}`;
    let w = digit.get(key);
    if (w === undefined) {
      const probe = document.createElement("span");
      probe.textContent = "0123456789";
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${weight} ${size}px ${fontFamily};font-variant-numeric:tabular-nums`;
      host.appendChild(probe);
      w = probe.getBoundingClientRect().width / 10;
      probe.remove();
      if (!(w > 0)) w = plain("0", size, weight);
      digit.set(key, w);
    }
    return w;
  };
  return (text, font) => {
    const key = `${font.tabular ? "t" : "p"}${font.weight}/${font.size}/${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      if (font.tabular) {
        const digits = text.replace(/\D/g, "").length;
        w = digits * digitWidth(font.size, font.weight);
        for (const part of text.split(/\d+/)) if (part) w += plain(part, font.size, font.weight);
      } else {
        w = plain(text, font.size, font.weight);
      }
      cache.set(key, w);
    }
    return w;
  };
}

/** The first opaque background behind `el`: what label halos must match. */
function backgroundBehind(el: HTMLElement | null): string | null {
  for (let node = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) continue;
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if (alpha > 0.5) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  }
  return null;
}

interface Box {
  width: number;
  viewport: number;
  /** Replaced when the font changes or finishes loading. */
  measure: MeasureText | undefined;
}

/* ───────────────────────────── Timeline ──────────────────────────── */

interface Timeline {
  /** ms after the start at which each node begins to appear. */
  node: Map<string, number>;
  /** Per source column: when its ribbons start to pour, and for how long. */
  flow: Map<number, { delay: number; duration: number }>;
  total: number;
}

const NODE_MS = 440;
const LABEL_MS = 460;
const LABEL_LAG = 110;
const COUNT_MS = 620;

/** Money moves left to right: a column appears as the ribbons reach it. */
function buildTimeline(layout: SankeyLayout): Timeline {
  const cols = Math.max(1, layout.columns);
  const step = Math.min(620, Math.max(300, 1350 / Math.max(1, cols - 1)));
  const perColumn = new Map<number, LayoutNode[]>();
  for (const n of layout.nodes) {
    const list = perColumn.get(n.column) ?? [];
    list.push(n);
    perColumn.set(n.column, list);
  }
  const node = new Map<string, number>();
  let total = 0;
  for (const [c, list] of perColumn) {
    const spreadMs = Math.min(190, 26 * list.length);
    const sorted = [...list].sort((a, b) => a.y - b.y);
    sorted.forEach((n, i) => {
      // The first column is simply there; later ones wait for the flow.
      const at = c * step + (c === 0 ? 0 : 60) + (sorted.length > 1 ? (i / (sorted.length - 1)) * spreadMs : 0);
      node.set(n.id, at);
      total = Math.max(total, at + LABEL_LAG + COUNT_MS);
    });
  }
  const flow = new Map<number, { delay: number; duration: number }>();
  for (let c = 0; c < cols - 1; c++) {
    flow.set(c, { delay: c * step + 120, duration: step + 260 });
  }
  return { node, flow, total: total + 80 };
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/* ────────────────────────────── Styles ───────────────────────────── */

const CSS = `
.fsk-root{position:relative;width:100%}
.fsk-svg{display:block;overflow:visible;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.fsk-svg text{font-family:inherit;font-variant-numeric:tabular-nums;pointer-events:none}
.fsk-hit{cursor:pointer}
.fsk-dim{transition:opacity .18s ease}
.fsk-node-g:focus{outline:none}
.fsk-node-g:focus-visible .fsk-ring{opacity:1}
.fsk-ring{opacity:0}
@keyframes fsk-node{from{opacity:0;transform:scaleY(.25)}to{opacity:1;transform:scaleY(1)}}
@keyframes fsk-label-r{from{opacity:0;transform:translate(-6px,3px)}to{opacity:1;transform:translate(0,0)}}
@keyframes fsk-label-l{from{opacity:0;transform:translate(6px,3px)}to{opacity:1;transform:translate(0,0)}}
@keyframes fsk-label-t{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes fsk-wipe{from{transform:translateX(var(--fsk-from)) skewX(var(--fsk-skew))}to{transform:translateX(0px) skewX(var(--fsk-skew))}}
@keyframes fsk-fade{from{opacity:0}to{opacity:1}}
.fsk-in .fsk-node{transform-box:fill-box;transform-origin:center;animation:fsk-node ${NODE_MS}ms cubic-bezier(.2,.9,.25,1) both}
.fsk-in .fsk-label{animation:${LABEL_MS}ms cubic-bezier(.2,.8,.2,1) both}
.fsk-in .fsk-label-right{animation-name:fsk-label-r}
.fsk-in .fsk-label-left{animation-name:fsk-label-l}
.fsk-in .fsk-label-top{animation-name:fsk-label-t}
.fsk-in .fsk-leader{animation:fsk-fade ${LABEL_MS}ms ease both}
.fsk-wipe{transform-box:fill-box;transform-origin:center;animation:fsk-wipe cubic-bezier(.45,.05,.2,1) both}
.fsk-calm{animation:fsk-fade .32s ease both}
.fsk-tip{position:absolute;left:0;top:0;z-index:5;pointer-events:none;max-width:min(260px,calc(100vw - 16px));opacity:0;transition:opacity .12s ease}
.fsk-tip[data-show="true"]{opacity:1}
`;

/* ───────────────────────────── Component ─────────────────────────── */

type Active = { type: "node" | "link"; id: string };

interface TipState extends Active {
  /** Tapped or focused rather than hovered: sits centered above the point. */
  touch: boolean;
}

export function SankeyChart({ graph, hideAmounts = false, className, animateKey, onReady }: SankeyChartProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [theme] = useTheme();
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getReducedServer);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const [box, setBox] = useState<Box | null>(null);
  const [surface, setSurface] = useState<string | null>(null);

  /* Measure the container; re-measure text once web fonts are in. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let epoch = 0;
    let measurer: { key: string; measure: MeasureText | undefined } | null = null;
    const read = () => {
      const width = Math.round(el.getBoundingClientRect().width);
      if (width <= 0) return;
      const viewport = window.innerHeight;
      const fontFamily = getComputedStyle(el).fontFamily || "sans-serif";
      const key = `${epoch}/${fontFamily}`;
      if (!measurer || measurer.key !== key) measurer = { key, measure: createMeasurer(el, fontFamily) };
      const measure = measurer.measure;
      setBox((prev) => {
        // Mobile browsers resize the viewport as their toolbars slide; only
        // a real change should move the chart.
        const keepViewport = prev && prev.width === width && Math.abs(prev.viewport - viewport) < 140;
        const next: Box = { width, viewport: keepViewport ? prev.viewport : viewport, measure };
        if (prev && prev.width === next.width && prev.viewport === next.viewport && prev.measure === next.measure) {
          return prev;
        }
        return next;
      });
      setSurface(backgroundBehind(el));
    };
    // Text is measured for layout, so wait (briefly) for the web font:
    // laying out with the fallback first would make the columns jump.
    let ready = false;
    let cancelled = false;
    const start = () => {
      if (cancelled || ready) return;
      ready = true;
      read();
    };
    const guarded = () => {
      if (ready) read();
    };
    const ro = new ResizeObserver(guarded);
    ro.observe(el);
    window.addEventListener("resize", guarded);
    const giveUp = window.setTimeout(start, 400);
    const fonts = document.fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => {
        if (cancelled) return;
        if (ready) epoch += 1; // arrived after the timeout: measure again
        ready = true;
        read();
      });
    } else {
      start();
    }
    return () => {
      cancelled = true;
      window.clearTimeout(giveUp);
      ro.disconnect();
      window.removeEventListener("resize", guarded);
    };
  }, []);

  /* The halo color follows the theme. */
  useEffect(() => {
    const id = requestAnimationFrame(() => setSurface(backgroundBehind(wrapRef.current)));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  const layout = useMemo(() => {
    if (!box) return null;
    const compact = box.width < SANKEY_COMPACT_BELOW;
    return computeLayout(graph, {
      width: box.width,
      height: pickSankeyHeight(graph, box.width, box.viewport),
      compact,
      hideAmounts,
      measureText: box.measure,
    });
  }, [graph, box, hideAmounts]);

  const colors = useMemo(() => getFlowColors(graph, theme), [graph, theme]);
  const ui = UI_TOKENS[theme];
  const halo = surface ?? ui.bg;

  /* ── Entrance: replay when animateKey changes, never otherwise ── */
  const [play, setPlay] = useState({ key: animateKey, run: 0 });
  if (play.key !== animateKey) setPlay({ key: animateKey, run: play.run + 1 });
  const [finishedRun, setFinishedRun] = useState(-1);
  const hasLayout = layout !== null;
  const entering = hasLayout && finishedRun !== play.run;
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });
  const timeline = useMemo(() => (layout ? buildTimeline(layout) : null), [layout]);
  const timelineRef = useRef(timeline);
  useLayoutEffect(() => {
    timelineRef.current = timeline;
  });

  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    if (hasLayout) onReadyRef.current?.();
  }, [hasLayout]);

  useEffect(() => {
    if (!hasLayout) return;
    const run = play.run;
    const svg = svgRef.current;
    const total = reduced ? 340 : (timelineRef.current?.total ?? 2200);
    const started = performance.now();
    let raf = 0;
    const amounts = () => (svg ? Array.from(svg.querySelectorAll<SVGTextElement>("[data-count]")) : []);
    const settle = () => {
      for (const el of amounts()) {
        const final = el.getAttribute("data-final") ?? "";
        if (el.firstChild && el.firstChild.nodeValue !== final) el.firstChild.nodeValue = final;
      }
    };
    const tick = (now: number) => {
      const t = now - started;
      const lay = layoutRef.current;
      const tl = timelineRef.current;
      if (lay && tl) {
        for (const el of amounts()) {
          const id = el.getAttribute("data-count") ?? "";
          const value = Number(el.getAttribute("data-value"));
          const final = el.getAttribute("data-final") ?? "";
          const p = (t - (tl.node.get(id) ?? 0) - LABEL_LAG) / COUNT_MS;
          const text = p >= 1 ? final : formatFlowAmount(value * easeOutCubic(Math.max(0, p)), lay.amountFormat);
          // Mutate the text node in place: React keeps its reference to it.
          if (el.firstChild && el.firstChild.nodeValue !== text) el.firstChild.nodeValue = text;
        }
      }
      if (t < total) raf = requestAnimationFrame(tick);
    };
    if (!reduced) raf = requestAnimationFrame(tick);
    const timer = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      settle();
      setFinishedRun(run);
    }, total + 60);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      settle();
    };
  }, [play.run, hasLayout, reduced]);

  /* ── Highlight ── */
  const [hover, setHover] = useState<Active | null>(null);
  const [pinned, setPinned] = useState<Active | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  /** Where the tooltip points, in wrapper coordinates. */
  const anchorRef = useRef({ x: 0, y: 0 });
  const active = hover ?? pinned;

  const lit = useMemo(() => {
    if (!layout || !active) return null;
    const out = new Map<string, LayoutLink[]>();
    const into = new Map<string, LayoutLink[]>();
    for (const l of layout.links) {
      (out.get(l.source) ?? out.set(l.source, []).get(l.source)!).push(l);
      (into.get(l.target) ?? into.set(l.target, []).get(l.target)!).push(l);
    }
    const nodes = new Set<string>();
    const links = new Set<string>();
    const walk = (start: string, edges: Map<string, LayoutLink[]>, next: (l: LayoutLink) => string) => {
      const queue = [start];
      while (queue.length) {
        const id = queue.pop()!;
        nodes.add(id);
        for (const l of edges.get(id) ?? []) {
          if (links.has(l.id)) continue;
          links.add(l.id);
          queue.push(next(l));
        }
      }
    };
    if (active.type === "node") {
      if (!layout.nodes.some((n) => n.id === active.id)) return null;
      walk(active.id, into, (l) => l.source);
      walk(active.id, out, (l) => l.target);
    } else {
      const link = layout.links.find((l) => l.id === active.id);
      if (!link) return null;
      links.add(link.id);
      walk(link.source, into, (l) => l.source);
      walk(link.target, out, (l) => l.target);
    }
    return { nodes, links };
  }, [layout, active]);

  const nodeById = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  const linkById = useMemo(() => new Map((layout?.links ?? []).map((l) => [l.id, l])), [layout]);

  const targetOf = (el: EventTarget | null): Active | null => {
    const hit = el instanceof Element ? el.closest("[data-node],[data-link]") : null;
    if (!hit) return null;
    const node = hit.getAttribute("data-node");
    if (node !== null) return { type: "node", id: node };
    return { type: "link", id: hit.getAttribute("data-link") ?? "" };
  };

  const placeTip = useCallback((x: number, y: number, touch: boolean) => {
    const wrap = wrapRef.current;
    const el = tipRef.current;
    if (!wrap || !el) return;
    const rect = wrap.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    // Stay inside both the chart and the viewport.
    const minX = Math.max(0, pad - rect.left);
    const maxX = Math.min(rect.width, window.innerWidth - pad - rect.left) - w;
    const minY = Math.max(-h, pad - rect.top);
    const maxY = Math.min(rect.height + h, window.innerHeight - pad - rect.top) - h;
    let left = touch ? x - w / 2 : x + 16;
    if (!touch && left > maxX) left = x - w - 16;
    let top = y - h - (touch ? 16 : 14);
    if (top < minY) top = y + (touch ? 22 : 20);
    left = Math.max(minX, Math.min(left, Math.max(minX, maxX)));
    top = Math.max(minY, Math.min(top, Math.max(minY, maxY)));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }, []);

  useLayoutEffect(() => {
    if (tip) placeTip(anchorRef.current.x, anchorRef.current.y, tip.touch);
  }, [tip, placeTip, hideAmounts, layout]);

  const localPoint = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    const hit = targetOf(e.target);
    const { x, y } = localPoint(e.clientX, e.clientY);
    if (!hit) {
      if (hover) setHover(null);
      if (tip && !pinned) setTip(null);
      else if (tip && pinned && (tip.id !== pinned.id || tip.type !== pinned.type)) setTip(null);
      return;
    }
    if (!hover || hover.id !== hit.id || hover.type !== hit.type) setHover(hit);
    anchorRef.current = { x, y };
    if (!tip || tip.id !== hit.id || tip.type !== hit.type || tip.touch) setTip({ ...hit, touch: false });
    else placeTip(x, y, false);
  };
  const onPointerLeave = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    setHover(null);
    setTip(null);
  };
  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const hit = targetOf(e.target);
    if (!hit || (pinned && pinned.id === hit.id && pinned.type === hit.type)) {
      setPinned(null);
      if (!hover) setTip(null);
      return;
    }
    setPinned(hit);
    anchorRef.current = localPoint(e.clientX, e.clientY);
    const native = e.nativeEvent as PointerEvent;
    setTip({ ...hit, touch: native.pointerType !== "mouse" });
  };
  const onFocus = (e: ReactFocusEvent<SVGSVGElement>) => {
    const hit = targetOf(e.target);
    if (!hit || !(e.target instanceof Element) || !e.target.matches(":focus-visible")) return;
    const r = e.target.getBoundingClientRect();
    anchorRef.current = localPoint(r.left + r.width / 2, r.top);
    setPinned(hit);
    setTip({ ...hit, touch: true });
  };
  const onBlur = () => {
    setPinned(null);
    setTip(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Escape") {
      setPinned(null);
      setHover(null);
      setTip(null);
    }
  };

  /* Tapping anywhere outside the chart clears a pinned highlight. */
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setPinned(null);
        setTip(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  /* ── Text for assistive tech ── */
  const incomeBase = graph.totals.income > 0 ? graph.totals.income : (layout?.hubValue ?? 0);
  const shareOfIncome = (value: number) => `${formatPercent(value, incomeBase)} of income`;
  const describeNode = (n: LayoutNode) =>
    hideAmounts ? `${n.name}: ${shareOfIncome(n.value)}` : `${n.name}: ${formatMoney(n.value, graph.currency)}, ${shareOfIncome(n.value)}`;
  const summary = useMemo(() => {
    if (!layout) return "";
    const fmt = (n: LayoutNode) => `${n.name} ${n.amountText}`;
    const list = (kinds: string[]) =>
      layout.nodes
        .filter((n) => kinds.includes(n.kind))
        .map(fmt)
        .join(", ");
    const hub = layout.nodes.find((n) => n.kind === "hub");
    const parts = [
      `${graph.title ? `${graph.title}. ` : ""}Sankey chart of money flowing from income to spending and savings.`,
      hub ? `${hub.name}: ${hub.amountText}.` : "",
      `Coming in: ${list(["income", "shortfall"])}.`,
      `Spending: ${list(["expense"]) || "none"}.`,
    ];
    const saved = list(["savings", "surplus"]);
    if (saved) parts.push(`Kept: ${saved}.`);
    return parts.filter(Boolean).join(" ");
  }, [layout, graph.title]);

  /* ── Render ── */
  const descId = `${uid}-desc`;
  const rootClass = `fsk-root${className ? ` ${className}` : ""}`;

  if (!layout || !timeline) {
    return (
      <div ref={wrapRef} className={rootClass} style={{ minHeight: 320 }}>
        <style>{CSS}</style>
      </div>
    );
  }

  const animated = entering && !reduced;
  const fs = layout.fontSize;
  const gradId = (l: LayoutLink) => `${uid}-g-${l.index}`;
  const hatchId = (group: string) => `${uid}-h-${layout.nodes.findIndex((n) => n.group === group)}`;
  const hatchedGroups = [...new Set(layout.nodes.filter((n) => n.hatched).map((n) => n.group))];
  const flowColumns = [...new Set(layout.links.map((l) => l.column))].sort((a, b) => a - b);
  const dimNode = (id: string) => (lit && !lit.nodes.has(id) ? 0.16 : 1);
  const dimLink = (id: string) => (lit && !lit.links.has(id) ? 0.12 : 1);
  const delayOf = (id: string) => timeline.node.get(id) ?? 0;

  const tipNode = tip?.type === "node" ? nodeById.get(tip.id) : undefined;
  const tipLink = tip?.type === "link" ? linkById.get(tip.id) : undefined;
  const tipInfo = tipNode
    ? { title: tipNode.name, value: tipNode.value, color: colors[tipNode.group], hub: tipNode.kind === "hub" }
    : tipLink
      ? {
          title: `${nodeById.get(tipLink.source)?.name ?? ""} → ${nodeById.get(tipLink.target)?.name ?? ""}`,
          value: tipLink.value,
          color: colors[tipLink.group],
          hub: false,
        }
      : null;

  const renderLabel = (n: LayoutNode, label: LayoutLabel) => {
    const style: CSSProperties | undefined = animated
      ? { animationDelay: `${Math.round(delayOf(n.id) + LABEL_LAG)}ms`, opacity: dimNode(n.id) }
      : { opacity: dimNode(n.id) };
    return (
      <g
        key={n.id}
        data-node={n.id}
        className={`fsk-label fsk-label-${label.side} fsk-dim fsk-hit`}
        style={style}
        aria-hidden="true"
      >
        {/* Generous, invisible hit area: tapping the text selects the node. */}
        <rect
          x={label.box.x - 3}
          y={label.box.y - 1}
          width={label.box.width + 6}
          height={label.box.height + 2}
          fill="transparent"
        />
        {label.runs.map((run) => (
          <text
            key={run.role}
            x={run.x}
            y={run.y}
            textAnchor={run.anchor}
            fontSize={run.fontSize}
            fontWeight={run.fontWeight}
            fill={
              // Names are ink, amounts muted; the hub flips that (small muted
              // name over a large amount) unless its name stands alone.
              (label.prominent ? run.role === "amount" || label.runs.length === 1 : run.role === "name")
                ? ui.text
                : ui.textMuted
            }
            stroke={label.halo ? halo : undefined}
            strokeWidth={label.halo ? Math.max(2, run.fontSize * 0.22) : undefined}
            strokeOpacity={label.halo ? 0.82 : undefined}
            strokeLinejoin={label.halo ? "round" : undefined}
            paintOrder={label.halo ? "stroke" : undefined}
            letterSpacing={label.prominent && run.fontSize > layout.fontSize ? "-0.02em" : undefined}
            {...(run.role === "amount"
              ? { "data-count": n.id, "data-value": n.value, "data-final": run.text }
              : null)}
          >
            {run.text}
          </text>
        ))}
      </g>
    );
  };

  return (
    <div ref={wrapRef} className={rootClass}>
      <style>{CSS}</style>
      <p id={descId} className="sr-only">
        {summary}
      </p>
      <svg
        ref={svgRef}
        key={reduced ? `calm-${play.run}` : "svg"}
        className={`fsk-svg${animated ? " fsk-in" : ""}${entering && reduced ? " fsk-calm" : ""}`}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={graph.title ? `Money flow, ${graph.title}` : "Money flow"}
        aria-describedby={descId}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        <defs>
          {layout.links.map((l) => {
            const [a, b] = getRibbonStops(l.sourceGroup, l.targetGroup, colors, theme);
            return (
              <linearGradient key={l.id} id={gradId(l)} gradientUnits="userSpaceOnUse" x1={l.x0} x2={l.x1} y1={0} y2={0}>
                <stop offset={a.offset} stopColor={a.color} stopOpacity={a.opacity} />
                <stop offset={b.offset} stopColor={b.color} stopOpacity={b.opacity} />
              </linearGradient>
            );
          })}
          {hatchedGroups.map((group) => (
            <pattern
              key={group}
              id={hatchId(group)}
              patternUnits="userSpaceOnUse"
              width={fs * 0.5}
              height={fs * 0.5}
              patternTransform="rotate(-45)"
            >
              <rect width={fs * 0.5} height={fs * 0.5} fill={colors[group]} fillOpacity={theme === "dark" ? 0.2 : 0.16} />
              <rect width={fs * 0.5} height={fs * 0.15} fill={colors[group]} fillOpacity={0.5} />
            </pattern>
          ))}
          {animated &&
            flowColumns.map((c) => {
              const group = layout.links.filter((l) => l.column === c);
              const x0 = Math.min(...group.map((l) => l.x0));
              const x1 = Math.max(...group.map((l) => l.x1));
              const span = x1 - x0;
              // The front leans forward (ribbons at the top lead, the rest
              // follow) and is soft: a fading edge, not a hard cut.
              const lean = Math.min(span * 0.3, layout.height * 0.08);
              const soft = Math.min(80, Math.max(14, span * 0.3));
              const solid = span + 2 * lean;
              const w = solid + soft;
              const skew = (Math.atan((2 * lean) / layout.height) * 180) / Math.PI;
              const flow = timeline.flow.get(c) ?? { delay: 0, duration: 700 };
              return (
                <mask
                  key={`${play.run}-${c}`}
                  id={`${uid}-m-${c}`}
                  maskUnits="userSpaceOnUse"
                  x={0}
                  y={0}
                  width={layout.width}
                  height={layout.height}
                >
                  <linearGradient id={`${uid}-w-${c}`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset={0} stopColor="#fff" />
                    <stop offset={solid / w} stopColor="#fff" />
                    <stop offset={1} stopColor="#fff" stopOpacity={0} />
                  </linearGradient>
                  <rect
                    className="fsk-wipe"
                    x={x0 - lean}
                    y={0}
                    width={w}
                    height={layout.height}
                    fill={`url(#${uid}-w-${c})`}
                    style={
                      {
                        "--fsk-from": `${-Math.ceil(w + 2 * lean + 2)}px`,
                        "--fsk-skew": `${(-skew).toFixed(2)}deg`,
                        animationDelay: `${Math.round(flow.delay)}ms`,
                        animationDuration: `${Math.round(flow.duration)}ms`,
                      } as CSSProperties
                    }
                  />
                </mask>
              );
            })}
        </defs>

        {/* Ribbons, one group per column gap so each gap can pour as one. */}
        {flowColumns.map((c) => (
          <g key={c} mask={animated ? `url(#${uid}-m-${c})` : undefined}>
            {layout.links
              .filter((l) => l.column === c)
              .map((l) => {
                const s = nodeById.get(l.source);
                const t = nodeById.get(l.target);
                const what = hideAmounts ? shareOfIncome(l.value) : `${formatMoney(l.value, graph.currency)}, ${shareOfIncome(l.value)}`;
                return (
                  <path
                    key={l.id}
                    d={l.path}
                    data-link={l.id}
                    className="fsk-dim fsk-hit"
                    fill={l.hatched ? `url(#${hatchId(l.group)})` : `url(#${gradId(l)})`}
                    style={{ opacity: dimLink(l.id) }}
                    aria-label={`${s?.name ?? ""} to ${t?.name ?? ""}: ${what}`}
                  />
                );
              })}
          </g>
        ))}

        {/* Nodes */}
        <g key={`nodes-${play.run}`}>
          {layout.nodes.map((n) => {
            const color = colors[n.group] ?? ui.textFaint;
            const hitH = Math.max(n.height, Math.min(18, fs * 1.4));
            return (
              <g
                key={n.id}
                data-node={n.id}
                className="fsk-node-g fsk-dim fsk-hit"
                style={{ opacity: dimNode(n.id) }}
                tabIndex={0}
                aria-label={describeNode(n)}
              >
                <rect
                  x={n.x - 5}
                  y={n.y + n.height / 2 - hitH / 2}
                  width={n.width + 10}
                  height={hitH}
                  fill="transparent"
                />
                <rect
                  className="fsk-ring"
                  x={n.x - 3}
                  y={n.y - 3}
                  width={n.width + 6}
                  height={n.height + 6}
                  rx={n.radius + 3}
                  fill="none"
                  stroke={ui.accent}
                  strokeWidth={2}
                />
                <rect
                  className="fsk-node"
                  x={n.hatched ? n.x + 0.5 : n.x}
                  y={n.hatched ? n.y + 0.5 : n.y}
                  width={n.hatched ? Math.max(0, n.width - 1) : n.width}
                  height={n.hatched ? Math.max(0, n.height - 1) : n.height}
                  rx={n.radius}
                  fill={n.hatched ? `url(#${hatchId(n.group)})` : color}
                  stroke={n.hatched ? color : undefined}
                  strokeWidth={n.hatched ? 1 : undefined}
                  style={animated ? { animationDelay: `${Math.round(delayOf(n.id))}ms` } : undefined}
                />
              </g>
            );
          })}
        </g>

        {/* Leaders and labels */}
        <g key={`labels-${play.run}`}>
          {layout.nodes.map((n) =>
            n.label?.leader ? (
              <line
                key={n.id}
                className="fsk-leader fsk-dim"
                x1={n.label.leader.x1}
                y1={n.label.leader.y1}
                x2={n.label.leader.x2}
                y2={n.label.leader.y2}
                stroke={ui.textFaint}
                strokeWidth={1}
                strokeLinecap="round"
                style={{
                  opacity: dimNode(n.id) * 0.9,
                  animationDelay: animated ? `${Math.round(delayOf(n.id) + LABEL_LAG)}ms` : undefined,
                }}
              />
            ) : null,
          )}
          {layout.nodes.map((n) => (n.label ? renderLabel(n, n.label) : null))}
        </g>
      </svg>

      <div ref={tipRef} className="fsk-tip" data-show={tipInfo ? "true" : "false"} role="status">
        {tipInfo && (
          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] leading-snug text-text shadow-[0_6px_24px_rgba(0,0,0,0.14)]">
            <div className="flex items-center gap-2 font-medium">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: tipInfo.color }}
              />
              <span className="min-w-0 break-words">{tipInfo.title}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
              {!hideAmounts && <span className="text-[15px] font-semibold">{formatMoney(tipInfo.value, graph.currency)}</span>}
              <span className="text-text-muted">{shareOfIncome(tipInfo.value)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SankeyChart;
