import type { FlumeGraph, GraphNode, NodeKind, ThemeName } from "./types";

/**
 * Flow colors. Every `group` key in a graph resolves to one hex per theme.
 *
 * The scheme is semantic: money coming in is green/teal (the brand family),
 * money going out is warm (coral → amber → pink → violet), money kept is blue.
 * Light and dark lists are tuned separately (OKLCH, checked with the dataviz
 * palette validator against #F6F6F2 and #0A0D0C): same hue order, different
 * lightness and chroma steps.
 */

/** `group` key of the hub node (see types.ts). */
export const HUB_GROUP = "hub";

/** Income shades, in order of appearance. First is the brand accent. */
export const INCOME_COLORS: Record<ThemeName, readonly string[]> = {
  light: ["#0A7F71", "#3EAF86", "#016770", "#61C6B1", "#448C56", "#01544D"],
  dark: ["#45E0C8", "#29A987", "#24C1C9", "#A7F0D8", "#5BBD74", "#16827D"],
};

/**
 * Expense hues, assigned in graph order, so the first (largest) categories
 * get the best separated colors. Adjacent slots clear the validator's CVD
 * target (ΔE ≥ 8) and normal-vision floor (ΔE ≥ 15) in both themes.
 */
export const EXPENSE_COLORS: Record<ThemeName, readonly string[]> = {
  //       coral      violet     amber      pink       orange     purple     brick      gold       rose       brown
  light: ["#E55033", "#7855DF", "#E0A61E", "#D23C8D", "#E57C20", "#A240B2", "#AF2934", "#A59C2A", "#E8809A", "#985521"],
  dark: ["#ED6044", "#937CF1", "#BB8A1B", "#E25C9F", "#D87725", "#B956C8", "#C43E45", "#9D9631", "#D07392", "#925019"],
};

/** Savings shades: one blue family, distinct from every expense hue. */
export const SAVINGS_COLORS: Record<ThemeName, readonly string[]> = {
  light: ["#0B66D6", "#52AFE7", "#2E47A9", "#338DDF"],
  dark: ["#4A91F8", "#2C5DBD", "#34A1C6", "#3177DC"],
};

/** The hub is ink, not a hue: every color pools into it and leaves it. */
export const HUB_COLOR: Record<ThemeName, string> = {
  light: "#1B2321",
  dark: "#E4EBE8",
};

/** "Left over": money not spent or saved. Neutral sage, drawn hatched. */
export const SURPLUS_COLOR: Record<ThemeName, string> = {
  light: "#7E9A8F",
  dark: "#8FAFA2",
};

/** "From savings": spending beyond income. Warning red, drawn hatched. */
export const SHORTFALL_COLOR: Record<ThemeName, string> = {
  light: "#C4432B",
  dark: "#F07F68",
};

/** A category literally named "Other" (or similar) is neutral gray. */
export const OTHER_COLOR: Record<ThemeName, string> = {
  light: "#9DA29E",
  dark: "#737B77",
};

/** Kinds drawn with a diagonal hatch instead of a solid fill. */
export const HATCHED_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["surplus", "shortfall"]);

const OTHER_NAMES = /^(other|others|misc|misc\.|miscellaneous|everything else|uncategori[sz]ed)$/i;

type Family = "income" | "expense" | "savings" | "surplus" | "shortfall" | "hub";

function familyOf(kind: NodeKind): Family {
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
    case "surplus":
      return "surplus";
    case "shortfall":
      return "shortfall";
    default:
      return "hub";
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Linear sRGB mix of two hex colors; `t` = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return (
    "#" +
    ca
      .map((v, i) =>
        Math.round(v + (cb[i] - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

/**
 * Past the end of a list, reuse the hues one step softer each lap (mixed
 * toward the page background) rather than inventing new ones.
 */
function pick(list: readonly string[], index: number, theme: ThemeName): string {
  const base = list[index % list.length];
  const lap = Math.floor(index / list.length);
  if (lap === 0) return base;
  const toward = theme === "light" ? "#F6F6F2" : "#0A0D0C";
  return mixHex(base, toward, Math.min(0.6, 0.3 * lap));
}

/**
 * Resolve every `group` key used by the graph's nodes and links to a hex
 * color for `theme`. Colors are assigned in the order groups first appear in
 * `graph.nodes`, per family, so "simple" and "full" detail agree.
 */
export function getFlowColors(graph: FlumeGraph, theme: ThemeName): Record<string, string> {
  const colors: Record<string, string> = { [HUB_GROUP]: HUB_COLOR[theme] };
  const counters = { income: 0, expense: 0, savings: 0 };

  // The node that owns a group is the one whose id equals the group key
  // (a category); fall back to the first node carrying the key.
  const owners = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    const current = owners.get(node.group);
    if (!current || (node.id === node.group && current.id !== current.group)) {
      owners.set(node.group, node);
    }
  }

  for (const node of graph.nodes) {
    const key = node.group;
    if (key in colors) continue;
    const owner = owners.get(key) ?? node;
    const family = familyOf(owner.kind);
    if (family === "hub") {
      colors[key] = HUB_COLOR[theme];
    } else if (family === "surplus") {
      colors[key] = SURPLUS_COLOR[theme];
    } else if (family === "shortfall") {
      colors[key] = SHORTFALL_COLOR[theme];
    } else if (family === "expense" && OTHER_NAMES.test(owner.label.trim())) {
      colors[key] = OTHER_COLOR[theme];
    } else if (family === "income") {
      colors[key] = pick(INCOME_COLORS[theme], counters.income++, theme);
    } else if (family === "savings") {
      colors[key] = pick(SAVINGS_COLORS[theme], counters.savings++, theme);
    } else {
      colors[key] = pick(EXPENSE_COLORS[theme], counters.expense++, theme);
    }
  }

  // A link may name a group no node carries; never leave a key unresolved.
  for (const link of graph.links) {
    if (!(link.group in colors)) colors[link.group] = OTHER_COLOR[theme];
  }
  return colors;
}

export interface RibbonStop {
  /** 0 at the source end, 1 at the target end. */
  offset: number;
  color: string;
  opacity: number;
}

/** Ribbon fill opacity at the source and target end, per theme. */
export const RIBBON_OPACITY: Record<ThemeName, { source: number; target: number }> = {
  light: { source: 0.5, target: 0.3 },
  dark: { source: 0.56, target: 0.34 },
};

/**
 * Gradient stops for a ribbon running from a node of `sourceGroup` to a node
 * of `targetGroup`. The hub is ink and would muddy any hue it is blended
 * with, so at a hub end the ribbon keeps the color of its other end and only
 * the opacity ramps; between two colored nodes the hue ramps too.
 */
export function getRibbonStops(
  sourceGroup: string,
  targetGroup: string,
  colors: Record<string, string>,
  theme: ThemeName,
): [RibbonStop, RibbonStop] {
  const fallback = OTHER_COLOR[theme];
  let from = colors[sourceGroup] ?? fallback;
  let to = colors[targetGroup] ?? fallback;
  if (sourceGroup === HUB_GROUP && targetGroup !== HUB_GROUP) from = to;
  if (targetGroup === HUB_GROUP && sourceGroup !== HUB_GROUP) to = from;
  const { source, target } = RIBBON_OPACITY[theme];
  return [
    { offset: 0, color: from, opacity: source },
    { offset: 1, color: to, opacity: target },
  ];
}
