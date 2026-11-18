"use client";

import { formatMoney, formatPercent } from "@/lib/flume/format";
import type { FlumeTotals } from "@/lib/flume/types";
import { cx } from "./ui";

export interface TotalsProps {
  totals: FlumeTotals;
  currency: string;
  /** Number of distinct income sources in the data. */
  sources: number;
  /** Show shares of income instead of amounts. */
  hideAmounts: boolean;
  className?: string;
}

interface Cell {
  label: string;
  value: string;
  note: string;
  tone?: "danger";
}

/** Income, spent, saved and what is left, with the savings rate. 2×2 on phones. */
export function Totals({ totals, currency, sources, hideAmounts, className }: TotalsProps) {
  const { income, expenses, savings, surplus, shortfall } = totals;
  const hasIncome = income > 0;
  const share = (value: number) => (hasIncome ? formatPercent(value, income) : null);
  const money = (value: number) => formatMoney(value, currency, { compact: Math.abs(value) >= 10_000_000 });
  // With amounts hidden the share becomes the headline and the note names it.
  const cell = (label: string, value: number, unit: string, tone?: "danger"): Cell => {
    const pct = share(value);
    if (hideAmounts) return { label, value: pct ?? "–", note: pct ? unit : "", tone };
    return { label, value: money(value), note: pct ? `${pct} ${unit}` : "", tone };
  };

  const sourcesNote = sources === 1 ? "1 source" : `${sources} sources`;
  const cells: Cell[] = [
    { label: "Income", value: hideAmounts ? (hasIncome ? "100%" : "–") : money(income), note: sourcesNote },
    cell("Spent", expenses, "of income"),
    cell("Saved", savings, "savings rate"),
    shortfall > 0 ? cell("Shortfall", shortfall, "over income", "danger") : cell("Left over", surplus, "of income"),
  ];

  return (
    <dl className={cx("grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:gap-x-9 lg:gap-x-10 xl:grid xl:gap-x-6", className)}>
      {cells.map((c) => (
        <div key={c.label} className="min-w-0">
          <dt className="text-[13px] leading-5 text-text-muted">{c.label}</dt>
          <dd
            className={cx(
              "mt-0.5 truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums sm:text-[24px] sm:leading-8",
              c.tone === "danger" ? "text-danger" : "text-text",
            )}
          >
            {c.value}
          </dd>
          {/* Always rendered, so the row keeps its height when a note is empty. */}
          <dd className="min-h-[18px] text-[12.5px] leading-[18px] whitespace-nowrap text-text-faint tabular-nums">{c.note}</dd>
        </div>
      ))}
    </dl>
  );
}
