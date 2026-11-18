"use client";

import { Suspense, use, useMemo, useState } from "react";
import { SankeyChart } from "@/components/sankey/SankeyChart";
import type { Detail } from "@/lib/flume/types";
import { useTheme } from "@/lib/use-theme";
import { FIXTURES, fixtureGraph, type FixtureName } from "./fixture";

/**
 * Scratch page for the Sankey chart. State can be preset from the URL so a
 * screenshot script can reach any case directly:
 *   /dev/chart?data=heavy&detail=full&hide=1
 */

type Search = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
            o.value === value ? "bg-surface-2 font-medium text-text" : "text-text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Playground({ searchParams }: { searchParams: Search }) {
  const params = use(searchParams);
  const initialData = first(params.data);
  const [name, setName] = useState<FixtureName>(
    initialData && initialData in FIXTURES ? (initialData as FixtureName) : "sample",
  );
  const [detail, setDetail] = useState<Detail>(first(params.detail) === "simple" ? "simple" : "full");
  const [hide, setHide] = useState(first(params.hide) === "1");
  const [replay, setReplay] = useState(0);
  const [theme, setTheme] = useTheme();

  const graph = useMemo(() => fixtureGraph(name, detail), [name, detail]);
  const frame = first(params.frame) === "card";

  return (
    <main className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-8 sm:py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Dataset"
          value={name}
          onChange={setName}
          options={(Object.keys(FIXTURES) as FixtureName[]).map((k) => ({ value: k, label: FIXTURES[k].label }))}
        />
        <Segmented
          label="Detail"
          value={detail}
          onChange={setDetail}
          options={[
            { value: "simple", label: "Simple" },
            { value: "full", label: "Full" },
          ]}
        />
        <button
          type="button"
          aria-pressed={hide}
          onClick={() => setHide((v) => !v)}
          className={`rounded-lg border border-border px-2.5 py-1.5 text-[13px] ${
            hide ? "bg-surface-2 font-medium text-text" : "bg-surface text-text-muted"
          }`}
        >
          Hide amounts
        </button>
        <button
          type="button"
          onClick={() => setReplay((n) => n + 1)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-muted hover:text-text"
        >
          Replay
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-muted hover:text-text"
        >
          Toggle theme
        </button>
        <span className="text-[12px] text-text-faint tabular-nums">
          {graph.nodes.length} nodes · {graph.links.length} links · {graph.columns} columns
        </span>
      </div>

      <div className={frame ? "rounded-2xl border border-border bg-surface p-3 sm:p-6" : undefined}>
        <SankeyChart graph={graph} hideAmounts={hide} animateKey={`${name}-${detail}-${replay}`} />
      </div>
    </main>
  );
}

export default function ChartDevPage({ searchParams }: { searchParams: Search }) {
  // Reading the query string is request-time data: it must sit under Suspense.
  return (
    <Suspense fallback={null}>
      <Playground searchParams={searchParams} />
    </Suspense>
  );
}
