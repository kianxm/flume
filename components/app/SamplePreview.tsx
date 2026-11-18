"use client";

import { useMemo } from "react";
import { buildGraph } from "@/lib/flume/graph";
import { parseFlumeInput } from "@/lib/flume/parse";
import { SAMPLE_CSV } from "@/lib/flume/sample";
import { ChartFrame } from "./ChartFrame";
import { useMediaQuery } from "./hooks";
import { ArrowRightIcon } from "./icons";
import { cx } from "./ui";

const SAMPLE_DATA = parseFlumeInput(SAMPLE_CSV).data;

export interface SamplePreviewProps {
  onOpen: () => void;
  className?: string;
}

/**
 * The live chart on the landing page, drawn from the bundled sample and
 * labelled as such. It shows what the two steps lead to.
 */
export function SamplePreview({ onOpen, className }: SamplePreviewProps) {
  // The card is only wide enough for the subcategory columns on large screens.
  const roomy = useMediaQuery("(min-width: 1280px)");
  const graph = useMemo(
    () => (SAMPLE_DATA ? buildGraph(SAMPLE_DATA, { detail: roomy ? "full" : "simple" }) : null),
    [roomy],
  );
  if (!graph) return null;

  return (
    <figure className={cx("min-w-0 rounded-[20px] border border-border bg-surface", className)}>
      <figcaption className="flex items-center justify-between gap-3 py-2 pr-2 pl-4 sm:py-2.5 sm:pr-2.5 sm:pl-5">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="rounded-full bg-accent-soft px-2 py-[3px] text-[11px] leading-none font-semibold tracking-[0.06em] text-accent uppercase">
            Sample
          </span>
          <span className="truncate text-[13.5px] text-text-muted">Made-up numbers</span>
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium text-text transition-colors duration-150 hover:bg-surface-2 sm:h-9"
        >
          Open it
          <ArrowRightIcon size={15} />
        </button>
      </figcaption>
      <div className="px-1 pb-2 sm:px-4 sm:pb-4">
        <ChartFrame graph={graph} waitUntilVisible />
      </div>
    </figure>
  );
}
