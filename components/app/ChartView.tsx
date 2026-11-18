"use client";

import { useEffect, useRef } from "react";
import type { Detail, ExportFormat, FlumeGraph, ParseIssue } from "@/lib/flume/types";
import { ChartFrame } from "./ChartFrame";
import { ExportControl } from "./ExportControl";
import { PencilIcon, ReplayIcon } from "./icons";
import { Notes } from "./Notes";
import { TitleField } from "./TitleField";
import { Totals } from "./Totals";
import { Button, Segmented, Switch } from "./ui";

const DETAILS = [
  { value: "simple", label: "Simple" },
  { value: "full", label: "Full" },
] as const;

export interface ChartViewProps {
  graph: FlumeGraph;
  /** Number of distinct income sources in the data. */
  sources: number;
  issues: ParseIssue[];
  title: string;
  onTitleChange: (title: string) => void;
  detail: Detail;
  onDetailChange: (detail: Detail) => void;
  hideAmounts: boolean;
  onHideAmountsChange: (hide: boolean) => void;
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  animateKey: number;
  onReplay: () => void;
  onEdit: () => void;
  /** Move keyboard focus to the view when it appears after a user action. */
  focusOnMount: boolean;
}

/**
 * State 2: a chart is loaded. One grid, three arrangements:
 *   phone    title · totals · chart (edge to edge) · view controls · notes,
 *            with Export pinned to the bottom of the screen;
 *   tablet   title | export, then totals, view controls, chart, notes;
 *   desktop  a side column (title, totals, view controls, export, notes)
 *            beside the chart, so the whole chart fits in the window.
 */
export function ChartView({
  graph,
  sources,
  issues,
  title,
  onTitleChange,
  detail,
  onDetailChange,
  hideAmounts,
  onHideAmountsChange,
  format,
  onFormatChange,
  animateKey,
  onReplay,
  onEdit,
  focusOnMount,
}: ChartViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocus = useRef(focusOnMount);
  useEffect(() => {
    if (shouldFocus.current) headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-labelledby="chart-heading"
      className="mx-auto grid w-full max-w-[1360px] grid-cols-1 page-x pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-8 sm:pt-6 sm:pb-16 xl:grid-cols-[18.5rem_minmax(0,1fr)] xl:grid-rows-[repeat(5,auto)_1fr] xl:gap-x-12 xl:pt-4"
    >
      <h1 id="chart-heading" ref={headingRef} tabIndex={-1} className="sr-only">
        {title ? `Your money flow: ${title}` : "Your money flow"}
      </h1>

      <div className="order-1 min-w-0 sm:order-none xl:col-start-1 xl:row-start-1">
        <TitleField value={title} onCommit={onTitleChange} />
      </div>

      {/* Export: a bar pinned to the bottom on phones, inline everywhere else. */}
      <div className="sticky bottom-0 z-20 order-6 bleed-x mt-6 border-t border-border bg-bg/90 page-x pt-3 safe-b backdrop-blur-md sm:static sm:order-none sm:mx-0 sm:mt-0 sm:flex sm:items-center sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none xl:col-start-1 xl:row-start-4 xl:mt-5 xl:flex-col-reverse xl:items-stretch xl:gap-1 xl:border-t xl:pt-5">
        <div className="hidden sm:block xl:-ml-3 xl:self-start">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <PencilIcon size={16} />
            Edit data
          </Button>
        </div>
        <ExportControl graph={graph} hideAmounts={hideAmounts} format={format} onFormatChange={onFormatChange} />
      </div>

      <Totals
        totals={graph.totals}
        currency={graph.currency}
        sources={sources}
        hideAmounts={hideAmounts}
        className="order-2 mt-4 sm:order-none sm:col-span-2 sm:mt-5 xl:col-span-1 xl:col-start-1 xl:row-start-2"
      />

      <div className="order-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 sm:order-none sm:col-span-2 sm:mt-4 xl:col-span-1 xl:col-start-1 xl:row-start-3 xl:mt-6 xl:border-t xl:border-border xl:pt-5">
        <Segmented label="Detail" value={detail} options={DETAILS} onChange={onDetailChange} className="w-[168px]" />
        <Switch
          label="Hide amounts"
          checked={hideAmounts}
          onChange={onHideAmountsChange}
          className="order-last w-full justify-between sm:order-none sm:w-auto sm:justify-start xl:order-last xl:w-full xl:justify-between"
        />
        <Button variant="ghost" size="sm" onClick={onReplay} className="-mr-3 ml-auto sm:-mr-2.5 sm:ml-0 sm:px-2.5 xl:ml-auto">
          <ReplayIcon size={16} />
          Replay
        </Button>
      </div>

      <div className="order-3 bleed-x mt-5 min-w-0 px-2 sm:order-none sm:col-span-2 sm:mx-0 sm:mt-4 sm:rounded-[20px] sm:border sm:border-border sm:bg-surface sm:p-4 lg:p-6 xl:col-span-1 xl:col-start-2 xl:row-span-6 xl:row-start-1 xl:mt-0 xl:self-start">
        <ChartFrame graph={graph} hideAmounts={hideAmounts} animateKey={animateKey} />
      </div>

      <div className="order-5 mt-1 flex flex-wrap items-start justify-between gap-x-6 sm:order-none sm:col-span-2 sm:mt-3 xl:col-span-1 xl:col-start-1 xl:row-start-5 xl:mt-2">
        <Notes issues={issues} className="min-w-0 flex-1 basis-[16rem]" />
        <div className="-ml-3 sm:hidden">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <PencilIcon size={16} />
            Edit data
          </Button>
        </div>
      </div>
    </section>
  );
}
