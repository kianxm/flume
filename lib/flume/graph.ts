/**
 * Turns FlumeData rows into the node/link graph the chart draws.
 *
 *   income-detail → income ─┐                      ┌→ expense → expense-detail
 *                 shortfall ┴→ hub → ───────────────┼→ savings → savings-detail
 *                                                   └→ surplus
 *
 * All arithmetic is done in integer cents so that every node's inflow equals
 * its outflow exactly; values are converted back to currency units at the end.
 */
import type {
  Detail,
  FlowType,
  FlumeData,
  FlumeGraph,
  FlumeTotals,
  GraphLink,
  GraphNode,
} from "./types";

/**
 * At most this many category nodes in a column next to the hub. The synthetic
 * "From savings" / "Left over" nodes are not categories and do not count.
 */
const MAX_CATEGORIES = 10;
/** At most this many detail nodes hanging off one category. */
const MAX_DETAILS = 7;
/** Nodes below this share of the hub value are folded into "Other". */
const TINY_SHARE = 0.004;

const OTHER = "Other";

interface Sub {
  name: string;
  cents: number;
}

interface Cat {
  name: string;
  cents: number;
  /** Keyed by lower-cased subcategory name. */
  subs: Map<string, Sub>;
  /** Cents from rows (or folded categories) that have no subcategory. */
  bare: number;
  /** Order of first appearance, used as a stable tie-break. */
  order: number;
}

const isOtherName = (name: string) => name.trim().toLowerCase() === "other";

function byValueOtherLast<T extends { name: string; cents: number }>(
  a: T,
  b: T,
): number {
  const ao = isOtherName(a.name);
  const bo = isOtherName(b.name);
  if (ao !== bo) return ao ? 1 : -1;
  if (a.cents !== b.cents) return b.cents - a.cents;
  return 0;
}

function sortStable<T extends { name: string; cents: number }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => byValueOtherLast(x.item, y.item) || x.i - y.i)
    .map((x) => x.item);
}

/* ───────────────────────────── Aggregation ──────────────────────────── */

function aggregate(data: FlumeData): Record<FlowType, Cat[]> {
  const maps: Record<FlowType, Map<string, Cat>> = {
    income: new Map(),
    expense: new Map(),
    savings: new Map(),
  };
  let order = 0;
  for (const row of data.rows ?? []) {
    const map = maps[row.type];
    if (!map) continue;
    const cents = Math.round((Number(row.amount) || 0) * 100);
    if (!(cents > 0)) continue;
    const name = (row.category ?? "").trim() || OTHER;
    const key = name.toLowerCase();
    let cat = map.get(key);
    if (!cat) {
      cat = { name, cents: 0, subs: new Map(), bare: 0, order: order++ };
      map.set(key, cat);
    }
    cat.cents += cents;
    const sub = (row.subcategory ?? "").trim();
    if (!sub || sub.toLowerCase() === key) {
      cat.bare += cents;
    } else {
      const sk = sub.toLowerCase();
      const existing = cat.subs.get(sk);
      if (existing) existing.cents += cents;
      else cat.subs.set(sk, { name: sub, cents });
    }
  }
  return {
    income: [...maps.income.values()],
    expense: [...maps.expense.values()],
    savings: [...maps.savings.values()],
  };
}

/* ─────────────────────────────── Folding ────────────────────────────── */

interface FoldOps<T> {
  merge: (into: T, from: T) => void;
  make: () => T;
}

const catOps: FoldOps<Cat> = {
  merge(into, from) {
    into.cents += from.cents;
    into.bare += from.cents;
  },
  make: () => ({ name: OTHER, cents: 0, subs: new Map(), bare: 0, order: Infinity }),
};

const subOps: FoldOps<Sub> = {
  merge(into, from) {
    into.cents += from.cents;
  },
  make: () => ({ name: OTHER, cents: 0 }),
};

function removeItem<T>(items: T[], item: T) {
  const i = items.indexOf(item);
  if (i >= 0) items.splice(i, 1);
}

/**
 * Folds tiny items, then the smallest ones, into "Other" until at most
 * `limit` remain. Works on a copy.
 */
function foldSmall<T extends { name: string; cents: number }>(
  input: T[],
  limit: number,
  tinyBelow: number,
  ops: FoldOps<T>,
): T[] {
  const items = [...input];
  let other = items.find((x) => isOtherName(x.name));

  const tiny = items.filter((x) => x !== other && x.cents < tinyBelow);
  if (tiny.length >= 2) {
    if (!other) {
      other = ops.make();
      items.push(other);
    }
    for (const t of tiny) {
      ops.merge(other, t);
      removeItem(items, t);
    }
  }

  while (items.length > limit) {
    const rest = items
      .filter((x) => x !== other)
      .sort((a, b) => a.cents - b.cents);
    if (other && rest.length >= 1) {
      ops.merge(other, rest[0]);
      removeItem(items, rest[0]);
    } else if (!other && rest.length >= 2) {
      other = ops.make();
      items.push(other);
      for (const r of rest.slice(0, 2)) {
        ops.merge(other, r);
        removeItem(items, r);
      }
    } else {
      break;
    }
  }
  return items;
}

/**
 * The column to the right of the hub holds expense and savings categories
 * and may show at most `budget` of them between the two kinds. Folds the smallest category of either kind into its kind's
 * "Other" until it fits.
 */
function foldRightColumn(expense: Cat[], savings: Cat[], budget: number) {
  const candidate = (list: Cat[]) => {
    const other = list.find((c) => isOtherName(c.name));
    const rest = list.filter((c) => c !== other).sort((a, b) => a.cents - b.cents);
    if (other && rest.length >= 1) {
      return {
        weight: rest[0].cents,
        apply() {
          catOps.merge(other, rest[0]);
          removeItem(list, rest[0]);
        },
      };
    }
    if (!other && rest.length >= 2) {
      return {
        weight: rest[0].cents,
        apply() {
          const o = catOps.make();
          list.push(o);
          for (const r of rest.slice(0, 2)) {
            catOps.merge(o, r);
            removeItem(list, r);
          }
        },
      };
    }
    return null;
  };

  while (expense.length + savings.length > budget) {
    const options = [candidate(expense), candidate(savings)].filter(
      (x): x is NonNullable<typeof x> => x !== null,
    );
    if (options.length === 0) return;
    options.sort((a, b) => a.weight - b.weight);
    options[0].apply();
  }
}

/** The detail nodes for one category, or null when it is drawn alone. */
function detailsOf(cat: Cat, tinyBelow: number): Sub[] | null {
  const map = new Map<string, Sub>();
  for (const [k, s] of cat.subs) map.set(k, { name: s.name, cents: s.cents });
  if (cat.bare > 0 && map.size >= 1) {
    const other = map.get("other");
    if (other) other.cents += cat.bare;
    else map.set("other", { name: OTHER, cents: cat.bare });
  }
  let list = [...map.values()];
  if (list.length < 2) return null;
  list = foldSmall(list, MAX_DETAILS, tinyBelow, subOps);
  if (list.length < 2) return null;
  return sortStable(list);
}

/* ─────────────────────────────── Builder ────────────────────────────── */

export function buildGraph(
  data: FlumeData,
  opts: { detail?: Detail } = {},
): FlumeGraph {
  const detail: Detail = opts.detail === "simple" ? "simple" : "full";
  const agg = aggregate(data);
  const sum = (cats: Cat[]) => cats.reduce((s, c) => s + c.cents, 0);

  const incomeC = sum(agg.income);
  const expenseC = sum(agg.expense);
  const savingsC = sum(agg.savings);
  const outC = expenseC + savingsC;
  const hubC = Math.max(incomeC, outC);
  const surplusC = Math.max(0, incomeC - outC);
  const shortfallC = Math.max(0, outC - incomeC);
  const tinyBelow = hubC * TINY_SHARE;

  /* Readability limits. */
  const incomeCats = sortStable(
    foldSmall(agg.income, MAX_CATEGORIES, tinyBelow, catOps),
  );
  const expenseList = foldSmall(agg.expense, Infinity, tinyBelow, catOps);
  const savingsList = foldSmall(agg.savings, Infinity, tinyBelow, catOps);
  foldRightColumn(expenseList, savingsList, MAX_CATEGORIES);
  const expenseCats = sortStable(expenseList);
  const savingsCats = sortStable(savingsList);

  /* Detail nodes (full only). */
  const details = new Map<Cat, Sub[]>();
  if (detail === "full") {
    for (const cat of [...incomeCats, ...expenseCats, ...savingsCats]) {
      const d = detailsOf(cat, tinyBelow);
      if (d) details.set(cat, d);
    }
  }

  /* Ids. */
  const used = new Set<string>();
  const uid = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}#${n}`;
    used.add(id);
    return id;
  };

  const leftDetail: GraphNode[] = [];
  const left: GraphNode[] = [];
  const right: GraphNode[] = [];
  const rightDetail: GraphNode[] = [];
  const links: Array<Omit<GraphLink, "value"> & { cents: number }> = [];

  const hubId = uid("hub");

  const addCategory = (
    kind: "income" | "expense" | "savings",
    cat: Cat,
    into: GraphNode[],
    detailInto: GraphNode[],
  ) => {
    const id = uid(`${kind}:${cat.name}`);
    into.push({ id, label: cat.name, kind, column: 0, value: cat.cents / 100, group: id });
    if (kind === "income") links.push({ source: id, target: hubId, cents: cat.cents, group: id });
    else links.push({ source: hubId, target: id, cents: cat.cents, group: id });

    const subs = details.get(cat);
    if (!subs) return;
    const detailKind = `${kind}-detail` as "income-detail" | "expense-detail" | "savings-detail";
    for (const s of subs) {
      const sid = uid(`${id}/${s.name}`);
      detailInto.push({ id: sid, label: s.name, kind: detailKind, column: 0, value: s.cents / 100, group: id });
      if (kind === "income") links.push({ source: sid, target: id, cents: s.cents, group: id });
      else links.push({ source: id, target: sid, cents: s.cents, group: id });
    }
  };

  for (const c of incomeCats) addCategory("income", c, left, leftDetail);
  if (shortfallC > 0) {
    const id = uid("shortfall");
    left.push({ id, label: "From savings", kind: "shortfall", column: 0, value: shortfallC / 100, group: id });
    links.push({ source: id, target: hubId, cents: shortfallC, group: id });
  }

  for (const c of expenseCats) addCategory("expense", c, right, rightDetail);
  for (const c of savingsCats) addCategory("savings", c, right, rightDetail);
  if (surplusC > 0) {
    const id = uid("surplus");
    right.push({ id, label: "Left over", kind: "surplus", column: 0, value: surplusC / 100, group: id });
    links.push({ source: hubId, target: id, cents: surplusC, group: id });
  }

  const hub: GraphNode = {
    id: hubId,
    label: shortfallC > 0 ? "Budget" : "Income",
    kind: "hub",
    column: 0,
    value: hubC / 100,
    group: "hub",
  };

  /* Columns: contiguous from 0. */
  let col = 0;
  if (leftDetail.length > 0) {
    for (const n of leftDetail) n.column = col;
    col++;
  }
  if (left.length > 0) {
    for (const n of left) n.column = col;
    col++;
  }
  hub.column = col;
  const hubColumn = col++;
  if (right.length > 0) {
    for (const n of right) n.column = col;
    col++;
  }
  if (rightDetail.length > 0) {
    for (const n of rightDetail) n.column = col;
    col++;
  }

  const nodes = [...leftDetail, ...left, hub, ...right, ...rightDetail];
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const orderedLinks: GraphLink[] = links
    .map((l) => ({ ...l, s: index.get(l.source) ?? 0, t: index.get(l.target) ?? 0 }))
    .sort((a, b) => a.s - b.s || a.t - b.t)
    .map((l) => ({ source: l.source, target: l.target, value: l.cents / 100, group: l.group }));

  const totals: FlumeTotals = {
    income: incomeC / 100,
    expenses: expenseC / 100,
    savings: savingsC / 100,
    surplus: surplusC / 100,
    shortfall: shortfallC / 100,
  };

  const graph: FlumeGraph = {
    currency: data.currency || "USD",
    detail,
    columns: col,
    hubColumn,
    nodes,
    links: orderedLinks,
    totals,
  };
  if (data.title) graph.title = data.title;
  return graph;
}
