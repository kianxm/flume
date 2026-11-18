"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import {
  EXPORT_SIZES,
  exportFileName,
  exportPng,
  renderExportCanvas,
  saveImage,
  type ExportTuning,
} from "@/lib/flume/export";
import type { Detail, ExportFormat, FlumeGraph, ThemeName } from "@/lib/flume/types";
import { FIXTURES, fixtureGraph, type FixtureName } from "../chart/fixture";

/**
 * Scratch page for the PNG export. Every image here is the real exported
 * file (exportPng → Blob → object URL).
 *
 * Grid: each URL parameter narrows one axis, leave it out for all values.
 *   /dev/export?data=heavy&format=portrait
 * Single image at full size (any axis left out takes its first value):
 *   /dev/export?one=1&data=sample&format=landscape&theme=dark&detail=full&hide=0&scale=2
 * Extras: notitle=1 drops the title, title=<text> replaces it; fs=<px> and compact=0|1 override the
 * chart font size and layout (for tuning); data=empty|hub draw edge cases.
 */

type Search = Promise<Record<string, string | string[] | undefined>>;
type DataName = FixtureName | "empty" | "hub";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const DATA: DataName[] = [...(Object.keys(FIXTURES) as FixtureName[]), "empty", "hub"];
const FORMATS: ExportFormat[] = ["landscape", "portrait"];
const THEMES: ThemeName[] = ["light", "dark"];
const DETAILS: Detail[] = ["simple", "full"];
const HIDES = [false, true];

function edgeGraph(name: "empty" | "hub"): FlumeGraph {
  const totals = { income: 0, expenses: 0, savings: 0, surplus: 0, shortfall: 0 };
  if (name === "empty") {
    return { currency: "USD", detail: "simple", columns: 0, hubColumn: 0, nodes: [], links: [], totals };
  }
  return {
    title: "Only a hub",
    currency: "USD",
    detail: "simple",
    columns: 1,
    hubColumn: 0,
    nodes: [{ id: "hub", label: "Income", kind: "hub", column: 0, value: 0, group: "hub" }],
    links: [],
    totals,
  };
}

function graphFor(name: DataName, detail: Detail, noTitle: boolean, title?: string): FlumeGraph {
  const g = name === "empty" || name === "hub" ? edgeGraph(name) : fixtureGraph(name, detail);
  if (noTitle) return { ...g, title: undefined };
  return title ? { ...g, title } : g;
}

interface Combo {
  key: string;
  data: DataName;
  format: ExportFormat;
  theme: ThemeName;
  detail: Detail;
  hide: boolean;
}

interface Result {
  key: string;
  url?: string;
  width?: number;
  height?: number;
  bytes?: number;
  ms?: number;
  error?: string;
}

function pick<T extends string>(raw: string | undefined, all: readonly T[]): T[] {
  if (!raw) return [...all];
  const wanted = raw.split(",").filter((v): v is T => (all as readonly string[]).includes(v));
  return wanted.length ? wanted : [...all];
}

async function pngSize(blob: Blob): Promise<{ width: number; height: number }> {
  const head = new DataView(await blob.slice(0, 24).arrayBuffer());
  return { width: head.getUint32(16), height: head.getUint32(20) };
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png"),
  );
}

function Playground({ searchParams }: { searchParams: Search }) {
  const params = use(searchParams);
  const one = first(params.one) === "1";
  const noTitle = first(params.notitle) === "1";
  const titleParam = first(params.title);
  const fsParam = Number(first(params.fs));
  const compactParam = first(params.compact);
  const scaleParam = Number(first(params.scale));
  const scale = scaleParam > 0 ? scaleParam : one ? 2 : 1;
  const hideRaw = first(params.hide);

  const tuning = useMemo(() => {
    const t: Partial<ExportTuning> = {};
    if (fsParam > 0) t.chartFontSize = fsParam;
    if (compactParam === "0" || compactParam === "1") t.compact = compactParam === "1";
    return t;
  }, [fsParam, compactParam]);
  const tuned = Object.keys(tuning).length > 0;

  const combos = useMemo(() => {
    const data = pick(first(params.data), DATA).filter((d) => one || first(params.data) || (d !== "empty" && d !== "hub"));
    const formats = pick(first(params.format), FORMATS);
    const themes = pick(first(params.theme), THEMES);
    const details = pick(first(params.detail), DETAILS);
    const hides = hideRaw === "1" ? [true] : hideRaw === "0" ? [false] : HIDES;
    const out: Combo[] = [];
    for (const d of data)
      for (const f of formats)
        for (const t of themes)
          for (const de of details)
            for (const h of hides) {
              out.push({ key: `${d}-${f}-${t}-${de}-${h ? "hide" : "amounts"}`, data: d, format: f, theme: t, detail: de, hide: h });
            }
    return one ? out.slice(0, 1) : out;
  }, [params, one, hideRaw]);

  const [results, setResults] = useState<Result[]>([]);
  const [saved, setSaved] = useState<string>("");
  const blobs = useRef(new Map<string, Blob>());

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (window as unknown as { __exportDone?: boolean }).__exportDone = false;
    (async () => {
      const out: Result[] = [];
      for (const c of combos) {
        if (cancelled) return;
        const started = performance.now();
        try {
          const graph = graphFor(c.data, c.detail, noTitle, titleParam);
          const opts = { theme: c.theme, format: c.format, hideAmounts: c.hide, scale };
          let blob: Blob;
          if (tuned) {
            const canvas = await renderExportCanvas(graph, opts, tuning);
            blob = await encode(canvas);
          } else {
            blob = await exportPng(graph, opts);
          }
          const url = URL.createObjectURL(blob);
          urls.push(url);
          blobs.current.set(c.key, blob);
          const size = await pngSize(blob);
          out.push({ key: c.key, url, ...size, bytes: blob.size, ms: Math.round(performance.now() - started) });
        } catch (err) {
          out.push({ key: c.key, error: err instanceof Error ? err.message : String(err) });
        }
        if (!cancelled) setResults([...out]);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [combos, noTitle, titleParam, scale, tuning, tuned]);

  // Scripts wait for this before reading the images: set only once every
  // result has rendered.
  const done = results.length === combos.length;
  useEffect(() => {
    (window as unknown as { __exportDone?: boolean }).__exportDone = done;
  }, [done]);

  const byKey = new Map(results.map((r) => [r.key, r]));

  const save = async (c: Combo) => {
    const blob = blobs.current.get(c.key);
    if (!blob) return;
    const graph = graphFor(c.data, c.detail, noTitle, titleParam);
    setSaved("…");
    try {
      setSaved(await saveImage(blob, exportFileName(graph)));
    } catch (err) {
      setSaved(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-6 px-3 py-4 sm:px-8 sm:py-6">
      <p className="text-[13px] text-text-muted">
        {combos.length} export{combos.length === 1 ? "" : "s"} at scale {scale}
        {tuned ? ` · tuning ${JSON.stringify(tuning)}` : ""} · {results.length} done
      </p>
      <div className={one ? "flex flex-col gap-4" : "grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3"}>
        {combos.map((c) => {
          const r = byKey.get(c.key);
          const logical = EXPORT_SIZES[c.format];
          return (
            <figure key={c.key} className="flex min-w-0 flex-col gap-2">
              <figcaption className="flex flex-wrap items-center gap-3 text-[12px] text-text-muted tabular-nums">
                <a
                  className="underline"
                  href={`/dev/export?one=1&data=${c.data}&format=${c.format}&theme=${c.theme}&detail=${c.detail}&hide=${c.hide ? 1 : 0}${noTitle ? "&notitle=1" : ""}`}
                >
                  {c.key}
                </a>
                {r?.width ? (
                  <span>
                    {r.width}×{r.height}px · {Math.round((r.bytes ?? 0) / 1024)} KB · {r.ms} ms
                  </span>
                ) : null}
                {r?.url ? (
                  <button
                    type="button"
                    onClick={() => save(c)}
                    className="rounded-md border border-border bg-surface px-2 py-0.5 text-text"
                  >
                    Save image
                  </button>
                ) : null}
                {one && saved ? <span data-save-result>{saved}</span> : null}
              </figcaption>
              {r?.error ? (
                <p data-export-error={c.key} className="text-[13px] text-red-600">
                  {r.error}
                </p>
              ) : r?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-export={c.key}
                  src={r.url}
                  alt={c.key}
                  style={one ? { width: logical.width, maxWidth: "none" } : undefined}
                  className={one ? "block" : "block w-full rounded-lg border border-border"}
                />
              ) : (
                <div
                  className="rounded-lg border border-border bg-surface-2"
                  style={{ aspectRatio: `${logical.width} / ${logical.height}`, width: one ? logical.width : undefined }}
                />
              )}
            </figure>
          );
        })}
      </div>
    </main>
  );
}

export default function ExportDevPage({ searchParams }: { searchParams: Search }) {
  // Reading the query string is request-time data: it must sit under Suspense.
  return (
    <Suspense fallback={null}>
      <Playground searchParams={searchParams} />
    </Suspense>
  );
}
