import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";
import { parseFlumeInput } from "./parse";
import { SAMPLE_CSV } from "./sample";
import type { Detail, FlowRow, FlumeData, FlumeGraph, GraphNode } from "./types";

const cents = (n: number) => Math.round(n * 100);

function data(rows: FlowRow[], extra: Partial<FlumeData> = {}): FlumeData {
  return { currency: "USD", rows, ...extra };
}
const inc = (category: string, amount: number, subcategory?: string): FlowRow => ({
  type: "income", category, amount, ...(subcategory ? { subcategory } : {}),
});
const exp = (category: string, amount: number, subcategory?: string): FlowRow => ({
  type: "expense", category, amount, ...(subcategory ? { subcategory } : {}),
});
const sav = (category: string, amount: number, subcategory?: string): FlowRow => ({
  type: "savings", category, amount, ...(subcategory ? { subcategory } : {}),
});

const sampleData = () => parseFlumeInput(SAMPLE_CSV).data as FlumeData;

const byId = (g: FlumeGraph, id: string): GraphNode => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};
const inOf = (g: FlumeGraph, id: string) =>
  cents(g.links.filter((l) => l.target === id).reduce((s, l) => s + l.value, 0));
const outOf = (g: FlumeGraph, id: string) =>
  cents(g.links.filter((l) => l.source === id).reduce((s, l) => s + l.value, 0));
const column = (g: FlumeGraph, c: number) => g.nodes.filter((n) => n.column === c);
const kinds = (g: FlumeGraph, c: number) => [...new Set(column(g, c).map((n) => n.kind))];

/** Every invariant the chart relies on. */
function assertInvariants(g: FlumeGraph) {
  const ids = g.nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(g.nodes.filter((n) => n.kind === "hub")).toHaveLength(1);

  // Columns are contiguous from 0, and `columns`/`hubColumn` agree with the nodes.
  const cols = [...new Set(g.nodes.map((n) => n.column))].sort((a, b) => a - b);
  expect(cols).toEqual(cols.map((_, i) => i));
  expect(g.columns).toBe(cols.length);
  const hub = g.nodes.find((n) => n.kind === "hub") as GraphNode;
  expect(g.hubColumn).toBe(hub.column);
  // nodes appear column by column.
  const seq = g.nodes.map((n) => n.column);
  expect(seq).toEqual([...seq].sort((a, b) => a - b));

  // Links reference real nodes, flow left to right, and are positive.
  const idx = new Map(ids.map((id, i) => [id, i]));
  for (const l of g.links) {
    expect(idx.has(l.source)).toBe(true);
    expect(idx.has(l.target)).toBe(true);
    expect(byId(g, l.target).column).toBe(byId(g, l.source).column + 1);
    expect(l.value).toBeGreaterThan(0);
    // Link group is the group of whichever end is not the hub.
    const other = l.source === hub.id ? byId(g, l.target) : byId(g, l.source);
    const isDetailLink = byId(g, l.source).kind.endsWith("detail") || byId(g, l.target).kind.endsWith("detail");
    if (!isDetailLink) expect(l.group).toBe(other.group);
    else expect(l.group).toBe(byId(g, l.source).kind.endsWith("detail") ? byId(g, l.source).group : byId(g, l.target).group);
  }
  // Links are ordered to match node order (source first, then target).
  const keys = g.links.map((l) => [idx.get(l.source) as number, idx.get(l.target) as number]);
  for (let i = 1; i < keys.length; i++) {
    expect(keys[i][0] > keys[i - 1][0] || (keys[i][0] === keys[i - 1][0] && keys[i][1] >= keys[i - 1][1])).toBe(true);
  }

  // Flow conservation at every node.
  for (const n of g.nodes) {
    const v = cents(n.value);
    expect(v).toBeGreaterThan(0);
    switch (n.kind) {
      case "income-detail":
      case "shortfall":
        expect(inOf(g, n.id)).toBe(0);
        expect(outOf(g, n.id)).toBe(v);
        break;
      case "income":
        expect(outOf(g, n.id)).toBe(v);
        expect([0, v]).toContain(inOf(g, n.id));
        break;
      case "hub":
        expect(inOf(g, n.id)).toBe(v);
        expect(outOf(g, n.id)).toBe(v);
        break;
      case "expense":
      case "savings":
        expect(inOf(g, n.id)).toBe(v);
        expect([0, v]).toContain(outOf(g, n.id));
        break;
      case "surplus":
      case "expense-detail":
      case "savings-detail":
        expect(inOf(g, n.id)).toBe(v);
        expect(outOf(g, n.id)).toBe(0);
        break;
    }
  }

  // Totals.
  const t = g.totals;
  expect(cents(t.surplus)).toBe(Math.max(0, cents(t.income) - cents(t.expenses) - cents(t.savings)));
  expect(cents(t.shortfall)).toBe(Math.max(0, cents(t.expenses) + cents(t.savings) - cents(t.income)));
  expect(cents(hub.value)).toBe(Math.max(cents(t.income), cents(t.expenses) + cents(t.savings)));
}

describe("SAMPLE_CSV", () => {
  it.each<Detail>(["full", "simple"])("builds a valid graph at %s detail", (detail) => {
    const g = buildGraph(sampleData(), { detail });
    expect(g.detail).toBe(detail);
    assertInvariants(g);
    expect(g.title).toBe("October 2026");
    expect(g.currency).toBe("USD");
  });

  it("defaults to full detail", () => {
    expect(buildGraph(sampleData()).detail).toBe("full");
  });

  it("has the expected shape in full detail", () => {
    const g = buildGraph(sampleData());
    // Income has no subcategories, so the income categories are column 0.
    expect(g.columns).toBe(4);
    expect(g.hubColumn).toBe(1);
    expect(kinds(g, 0)).toEqual(["income"]);
    expect(kinds(g, 1)).toEqual(["hub"]);
    expect(kinds(g, 2)).toEqual(["expense", "savings", "surplus"]);
    expect(kinds(g, 3)).toEqual(["expense-detail", "savings-detail"]);
    expect(g.totals).toEqual({
      income: 7692.4,
      expenses: 5444.82,
      savings: 1550,
      surplus: 697.58,
      shortfall: 0,
    });
    expect(byId(g, "hub").label).toBe("Income");
    expect(byId(g, "hub").value).toBe(7692.4);
    expect(byId(g, "surplus").label).toBe("Left over");
    expect(byId(g, "surplus").value).toBe(697.58);
    expect(g.nodes.some((n) => n.kind === "shortfall")).toBe(false);
  });

  it("orders categories by value, Other last, savings after expenses, Left over at the bottom", () => {
    const g = buildGraph(sampleData());
    expect(column(g, 0).map((n) => n.label)).toEqual(["Salary", "Freelance", "Interest"]);
    expect(column(g, 2).map((n) => n.id)).toEqual([
      "expense:Housing",
      "expense:Food",
      "expense:Travel",
      "expense:Transport",
      "expense:Shopping",
      "expense:Health",
      "expense:Subscriptions",
      "expense:Other",
      "savings:Investments",
      "savings:Emergency fund",
      "surplus",
    ]);
  });

  it("keeps detail nodes under their parent's order, largest first", () => {
    const g = buildGraph(sampleData());
    expect(column(g, 3).map((n) => n.id)).toEqual([
      "expense:Housing/Rent",
      "expense:Housing/Utilities",
      "expense:Housing/Internet",
      "expense:Food/Groceries",
      "expense:Food/Restaurants",
      "expense:Food/Coffee",
      "expense:Travel/Flights",
      "expense:Travel/Lodging",
      "expense:Transport/Car payment",
      "expense:Transport/Gas",
      "expense:Transport/Transit",
      "expense:Shopping/Clothing",
      "expense:Shopping/Home",
      "expense:Health/Insurance",
      "expense:Health/Gym",
      "expense:Subscriptions/Software",
      "expense:Subscriptions/Streaming",
      "savings:Investments/401(k)",
      "savings:Investments/Brokerage",
    ]);
  });

  it("uses the category id as the group for a category and its details", () => {
    const g = buildGraph(sampleData());
    expect(byId(g, "hub").group).toBe("hub");
    expect(byId(g, "expense:Housing").group).toBe("expense:Housing");
    expect(byId(g, "expense:Housing/Rent").group).toBe("expense:Housing");
    expect(byId(g, "income:Salary").group).toBe("income:Salary");
    expect(byId(g, "surplus").group).toBe("surplus");
    const toHub = g.links.find((l) => l.source === "income:Salary");
    expect(toHub).toMatchObject({ target: "hub", group: "income:Salary", value: 6480 });
    const toDetail = g.links.find((l) => l.target === "expense:Housing/Rent");
    expect(toDetail).toMatchObject({ source: "expense:Housing", group: "expense:Housing", value: 2150 });
  });

  it("has exactly three columns in simple detail and no detail nodes", () => {
    const g = buildGraph(sampleData(), { detail: "simple" });
    expect(g.columns).toBe(3);
    expect(g.hubColumn).toBe(1);
    expect(g.nodes.some((n) => n.kind.endsWith("detail"))).toBe(false);
    expect(g.nodes).toHaveLength(3 + 1 + 8 + 2 + 1);
    // Same categories as full detail.
    const full = buildGraph(sampleData());
    expect(g.nodes.map((n) => n.id)).toEqual(full.nodes.filter((n) => !n.kind.endsWith("detail")).map((n) => n.id));
  });
});

describe("surplus and shortfall", () => {
  it("adds 'Left over' when income exceeds spending and saving", () => {
    const g = buildGraph(data([inc("Pay", 1000), exp("Rent", 600), sav("Fund", 100)]), { detail: "simple" });
    assertInvariants(g);
    expect(byId(g, "surplus")).toMatchObject({ label: "Left over", kind: "surplus", value: 300, column: 2 });
    expect(byId(g, "hub")).toMatchObject({ label: "Income", value: 1000 });
    expect(g.totals).toMatchObject({ surplus: 300, shortfall: 0 });
    expect(g.nodes.at(-1)?.id).toBe("surplus");
  });

  it("adds 'From savings' and renames the hub 'Budget' when spending exceeds income", () => {
    const g = buildGraph(data([inc("Pay", 1000), exp("Rent", 900), sav("Fund", 300)]), { detail: "simple" });
    assertInvariants(g);
    expect(byId(g, "shortfall")).toMatchObject({ label: "From savings", kind: "shortfall", value: 200, column: 0, group: "shortfall" });
    expect(byId(g, "hub")).toMatchObject({ label: "Budget", value: 1200 });
    expect(g.nodes.some((n) => n.kind === "surplus")).toBe(false);
    expect(g.totals).toMatchObject({ surplus: 0, shortfall: 200 });
    // The synthetic source sits below the real ones.
    expect(column(g, 0).map((n) => n.id)).toEqual(["income:Pay", "shortfall"]);
    expect(g.links.find((l) => l.source === "shortfall")).toMatchObject({ target: "hub", value: 200, group: "shortfall" });
  });

  it("shows neither when income equals spending plus saving", () => {
    const g = buildGraph(data([inc("Pay", 1000), exp("Rent", 700), sav("Fund", 300)]));
    assertInvariants(g);
    expect(g.nodes.some((n) => n.kind === "surplus" || n.kind === "shortfall")).toBe(false);
    expect(byId(g, "hub").label).toBe("Income");
  });

  it("handles spending with no income at all", () => {
    const g = buildGraph(data([exp("Rent", 900), exp("Food", 100)]));
    assertInvariants(g);
    expect(byId(g, "hub")).toMatchObject({ label: "Budget", value: 1000 });
    expect(column(g, 0).map((n) => n.id)).toEqual(["shortfall"]);
    expect(g.columns).toBe(3);
  });

  it("handles income with no spending at all", () => {
    const g = buildGraph(data([inc("Pay", 1000)]));
    assertInvariants(g);
    expect(column(g, 2).map((n) => n.id)).toEqual(["surplus"]);
  });

  it("handles an empty data set without throwing", () => {
    const g = buildGraph(data([]));
    expect(g.nodes).toHaveLength(1);
    expect(g.links).toHaveLength(0);
    expect(g.columns).toBe(1);
    expect(g.hubColumn).toBe(0);
  });
});

describe("detail nodes", () => {
  it("draws a category with zero or one subcategory alone", () => {
    const g = buildGraph(data([inc("Pay", 1000), exp("Rent", 500), exp("Food", 100, "Groceries"), exp("Fun", 50, "Fun")]));
    assertInvariants(g);
    expect(g.nodes.some((n) => n.kind.endsWith("detail"))).toBe(false);
    expect(g.columns).toBe(3);
  });

  it("adds an income detail column only when an income category has two or more subcategories", () => {
    const g = buildGraph(
      data([inc("Work", 3000, "Salary"), inc("Work", 500, "Bonus"), inc("Interest", 20, "Bank"), exp("Rent", 1000)]),
    );
    assertInvariants(g);
    expect(g.columns).toBe(4);
    expect(g.hubColumn).toBe(2);
    expect(column(g, 0).map((n) => n.id)).toEqual(["income:Work/Salary", "income:Work/Bonus"]);
    expect(kinds(g, 0)).toEqual(["income-detail"]);
    expect(column(g, 1).map((n) => n.id)).toEqual(["income:Work", "income:Interest"]);
    expect(g.links.find((l) => l.source === "income:Work/Salary")).toMatchObject({ target: "income:Work", value: 3000, group: "income:Work" });
  });

  it("makes the bare row an 'Other' detail when a category also has subcategories", () => {
    const g = buildGraph(data([inc("Pay", 3000), exp("Housing", 300), exp("Housing", 1000, "Rent"), exp("Housing", 100, "Water")]));
    assertInvariants(g);
    const labels = g.nodes.filter((n) => n.kind === "expense-detail").map((n) => [n.label, n.value]);
    expect(labels).toEqual([["Rent", 1000], ["Water", 100], ["Other", 300]]);
    expect(byId(g, "expense:Housing/Other").value).toBe(300);
  });

  it("merges the bare row into an existing 'Other' subcategory", () => {
    const g = buildGraph(data([inc("Pay", 3000), exp("Housing", 300), exp("Housing", 50, "other"), exp("Housing", 1000, "Rent")]));
    assertInvariants(g);
    const others = g.nodes.filter((n) => n.kind === "expense-detail" && n.label.toLowerCase() === "other");
    expect(others).toHaveLength(1);
    expect(others[0].value).toBe(350);
  });

  it("treats one subcategory plus a bare row as two details", () => {
    const g = buildGraph(data([inc("Pay", 3000), exp("Housing", 300), exp("Housing", 1000, "Rent")]));
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "expense-detail").map((n) => n.id)).toEqual([
      "expense:Housing/Rent",
      "expense:Housing/Other",
    ]);
  });

  it("applies the same rules to savings", () => {
    const g = buildGraph(data([inc("Pay", 3000), sav("Invest", 300, "401(k)"), sav("Invest", 200, "IRA"), sav("Cash", 100)]));
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "savings-detail").map((n) => n.id)).toEqual([
      "savings:Invest/401(k)",
      "savings:Invest/IRA",
    ]);
  });

  it("sorts detail nodes largest first with Other last", () => {
    const g = buildGraph(
      data([inc("Pay", 9000), exp("Misc", 10, "Small"), exp("Misc", 500, "Big"), exp("Misc", 900, "Other"), exp("Misc", 100, "Mid")]),
    );
    expect(g.nodes.filter((n) => n.kind === "expense-detail").map((n) => n.label)).toEqual(["Big", "Mid", "Small", "Other"]);
  });
});

describe("readability limits", () => {
  const many = (n: number, f = exp) =>
    Array.from({ length: n }, (_, i) => f(`Cat ${String(i + 1).padStart(2, "0")}`, 1000 - i * 10));

  it("folds categories beyond ten into Other", () => {
    const g = buildGraph(data([inc("Pay", 50_000), ...many(15)]), { detail: "simple" });
    assertInvariants(g);
    const cats = g.nodes.filter((n) => n.kind === "expense");
    expect(cats).toHaveLength(10);
    expect(cats.at(-1)?.label).toBe("Other");
    // The ten largest minus one slot: nine kept, six folded.
    expect(cats.slice(0, 9).map((n) => n.label)).toEqual(Array.from({ length: 9 }, (_, i) => `Cat ${String(i + 1).padStart(2, "0")}`));
    const folded = Array.from({ length: 6 }, (_, i) => 1000 - (i + 9) * 10).reduce((a, b) => a + b, 0);
    expect(cats.at(-1)?.value).toBe(folded);
  });

  it("counts expense and savings categories together against the limit of ten", () => {
    const g = buildGraph(
      data([inc("Pay", 90_000), ...many(8), ...Array.from({ length: 6 }, (_, i) => sav(`Save ${i + 1}`, 900 - i * 10))]),
      { detail: "simple" },
    );
    assertInvariants(g);
    const cats = g.nodes.filter((n) => n.kind === "expense" || n.kind === "savings");
    expect(cats.length).toBeLessThanOrEqual(10);
    // Savings categories still come after every expense category.
    const firstSavings = g.nodes.findIndex((n) => n.kind === "savings");
    const lastExpense = g.nodes.map((n) => n.kind).lastIndexOf("expense");
    expect(firstSavings).toBeGreaterThan(lastExpense);
  });

  it("does not fold exactly ten categories, and does not count Left over", () => {
    const g = buildGraph(data([inc("Pay", 50_000), ...many(10)]), { detail: "simple" });
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "expense")).toHaveLength(10);
    expect(g.nodes.some((n) => n.id === "surplus")).toBe(true);
    expect(g.nodes.some((n) => n.label === "Other")).toBe(false);
  });

  it("merges folded categories into an existing Other category", () => {
    const g = buildGraph(data([inc("Pay", 50_000), ...many(12), exp("Other", 5)]), { detail: "simple" });
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "expense")).toHaveLength(10);
    expect(g.nodes.filter((n) => n.label === "Other")).toHaveLength(1);
  });

  it("folds income categories beyond ten as well", () => {
    const g = buildGraph(data([...many(14, inc), exp("Rent", 100)]), { detail: "simple" });
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "income")).toHaveLength(10);
    expect(g.nodes.filter((n) => n.kind === "income").at(-1)?.label).toBe("Other");
  });

  it("folds subcategories beyond seven into Other", () => {
    const subs = Array.from({ length: 12 }, (_, i) => exp("Food", 500 - i * 20, `Sub ${String(i + 1).padStart(2, "0")}`));
    const g = buildGraph(data([inc("Pay", 50_000), ...subs]));
    assertInvariants(g);
    const details = g.nodes.filter((n) => n.kind === "expense-detail");
    expect(details).toHaveLength(7);
    expect(details.at(-1)?.label).toBe("Other");
    expect(details.slice(0, 6).map((n) => n.label)).toEqual(Array.from({ length: 6 }, (_, i) => `Sub ${String(i + 1).padStart(2, "0")}`));
    expect(details.at(-1)?.value).toBe(Array.from({ length: 6 }, (_, i) => 500 - (i + 6) * 20).reduce((a, b) => a + b, 0));
  });

  it("keeps seven subcategories as they are", () => {
    const subs = Array.from({ length: 7 }, (_, i) => exp("Food", 500 - i * 20, `Sub ${i + 1}`));
    const g = buildGraph(data([inc("Pay", 50_000), ...subs]));
    expect(g.nodes.filter((n) => n.kind === "expense-detail")).toHaveLength(7);
    expect(g.nodes.some((n) => n.label === "Other")).toBe(false);
  });

  it("folds two or more nodes under 0.4% of the hub into Other", () => {
    // Hub is 10,000, so the threshold is 40.
    const g = buildGraph(data([inc("Pay", 10_000), exp("Rent", 3000), exp("Food", 1000), exp("Tiny A", 30), exp("Tiny B", 20), exp("Tiny C", 39.99)]), { detail: "simple" });
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "expense").map((n) => [n.label, n.value])).toEqual([
      ["Rent", 3000],
      ["Food", 1000],
      ["Other", 89.99],
    ]);
  });

  it("leaves a single tiny node alone", () => {
    const g = buildGraph(data([inc("Pay", 10_000), exp("Rent", 3000), exp("Tiny", 30)]), { detail: "simple" });
    expect(g.nodes.filter((n) => n.kind === "expense").map((n) => n.label)).toEqual(["Rent", "Tiny"]);
  });

  it("does not count a node of exactly 0.4% as tiny", () => {
    const g = buildGraph(data([inc("Pay", 10_000), exp("Rent", 3000), exp("A", 40), exp("B", 40)]), { detail: "simple" });
    expect(g.nodes.filter((n) => n.kind === "expense").map((n) => n.label)).toEqual(["Rent", "A", "B"]);
  });

  it("merges tiny categories into an existing Other", () => {
    const g = buildGraph(data([inc("Pay", 10_000), exp("Rent", 3000), exp("Other", 100), exp("A", 10), exp("B", 10)]), { detail: "simple" });
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "expense").map((n) => [n.label, n.value])).toEqual([["Rent", 3000], ["Other", 120]]);
  });

  it("folds tiny subcategories within their parent, and draws the category alone if nothing is left to split", () => {
    const g = buildGraph(
      data([inc("Pay", 10_000), exp("Home", 2000, "Rent"), exp("Home", 500, "Repairs"), exp("Fees", 10, "A"), exp("Fees", 10, "B"), exp("Fees", 10, "C")]),
    );
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.id.startsWith("expense:Home/")).map((n) => n.label)).toEqual(["Rent", "Repairs"]);
    // All three Fees details are tiny: they fold into one Other, which is the whole category.
    expect(g.nodes.some((n) => n.id.startsWith("expense:Fees/"))).toBe(false);
    expect(byId(g, "expense:Fees").value).toBe(30);
  });

  it("keeps Other last when folding changes the order", () => {
    const g = buildGraph(data([inc("Pay", 10_000), exp("Rent", 100), exp("Big other", 2000), exp("Other", 3000), exp("t1", 1), exp("t2", 1)]), { detail: "simple" });
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "expense").map((n) => n.label)).toEqual(["Big other", "Rent", "Other"]);
  });
});

describe("ids, rounding and robustness", () => {
  it("builds stable ids from kind, category and subcategory", () => {
    const g = buildGraph(data([inc("Pay", 100), exp("Housing", 50, "Rent"), exp("Housing", 20, "Water"), sav("Housing", 5)]));
    expect(g.nodes.map((n) => n.id)).toEqual([
      "income:Pay",
      "hub",
      "expense:Housing",
      "savings:Housing",
      "surplus",
      "expense:Housing/Rent",
      "expense:Housing/Water",
    ]);
  });

  it("is deterministic and does not mutate its input", () => {
    const d = sampleData();
    const before = JSON.stringify(d);
    const a = buildGraph(d);
    const b = buildGraph(d);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(d)).toBe(before);
  });

  it("keeps ids unique when names collide", () => {
    const g = buildGraph(data([inc("Pay", 1000), exp("Food/Drink", 100), exp("Food", 60, "Drink"), exp("Food", 40, "Meals")]));
    assertInvariants(g);
  });

  it("merges rows that repeat a category, case-insensitively", () => {
    const g = buildGraph(data([inc("Pay", 1000), exp("Food", 10), exp("food", 5.5), exp("Food", 4.5, "Snacks"), exp("FOOD", 1, "snacks")]), { detail: "simple" });
    assertInvariants(g);
    expect(byId(g, "expense:Food").value).toBe(21);
  });

  it("ignores rows with zero, negative or non-finite amounts", () => {
    const g = buildGraph(data([inc("Pay", 1000), exp("Food", 0), exp("Gas", -5), exp("Bad", NaN), exp("Rent", 300)]), { detail: "simple" });
    assertInvariants(g);
    expect(g.nodes.filter((n) => n.kind === "expense").map((n) => n.id)).toEqual(["expense:Rent"]);
  });

  it("keeps every sum exact to the cent despite floating point", () => {
    const rows: FlowRow[] = [inc("Pay", 0.3)];
    for (let i = 0; i < 40; i++) rows.push(exp(`C${i % 5}`, 0.1 + i * 0.01, `S${i}`));
    const g = buildGraph(data(rows));
    assertInvariants(g);
    for (const n of g.nodes) expect(n.value).toBe(Math.round(n.value * 100) / 100);
    for (const l of g.links) expect(l.value).toBe(Math.round(l.value * 100) / 100);
  });

  it("falls back to USD and omits the title when absent", () => {
    const g = buildGraph({ currency: "", rows: [inc("Pay", 1)] });
    expect(g.currency).toBe("USD");
    expect("title" in g).toBe(false);
    expect(buildGraph(data([inc("Pay", 1)], { currency: "EUR", title: "Q1" }))).toMatchObject({ currency: "EUR", title: "Q1" });
  });

  it("stays valid for a large, messy file in both detail levels", () => {
    const rows: FlowRow[] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) rows.push(inc(`Income ${i}`, 500 + i * 37 + j, j ? `Source ${j}` : undefined));
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 12; j++) rows.push(exp(`Expense ${i}`, 1 + ((i * 31 + j * 17) % 400) / 3, j % 4 === 3 ? undefined : `Sub ${j}`));
    }
    for (let i = 0; i < 9; i++) rows.push(sav(`Savings ${i}`, 20 + i * 11, i % 2 ? "Sub" : undefined));
    for (const detail of ["full", "simple"] as const) {
      const g = buildGraph(data(rows), { detail });
      assertInvariants(g);
      expect(g.nodes.filter((n) => n.kind === "expense" || n.kind === "savings").length).toBeLessThanOrEqual(10);
      expect(g.nodes.filter((n) => n.kind === "income").length).toBeLessThanOrEqual(10);
      for (const n of g.nodes.filter((x) => x.kind === "expense")) {
        expect(g.nodes.filter((d) => d.kind === "expense-detail" && d.group === n.id).length).toBeLessThanOrEqual(7);
      }
      if (detail === "simple") expect(g.columns).toBe(3);
    }
  });
});

describe("link order", () => {
  it("orders links by source then target position so ribbons do not cross", () => {
    const g = buildGraph(sampleData());
    const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
    const hubOut = g.links.filter((l) => l.source === "hub").map((l) => idx.get(l.target) as number);
    expect(hubOut).toEqual([...hubOut].sort((a, b) => a - b));
    const intoHub = g.links.filter((l) => l.target === "hub").map((l) => idx.get(l.source) as number);
    expect(intoHub).toEqual([...intoHub].sort((a, b) => a - b));
    const housing = g.links.filter((l) => l.source === "expense:Housing").map((l) => l.target);
    expect(housing).toEqual(["expense:Housing/Rent", "expense:Housing/Utilities", "expense:Housing/Internet"]);
  });
});
