"use client";

import { useInView } from "motion/react";
import { useRef } from "react";
import { SankeyChart } from "@/components/sankey/SankeyChart";
import type { FlumeGraph } from "@/lib/flume/types";
import { cx } from "./ui";

export interface ChartFrameProps {
  graph: FlumeGraph;
  hideAmounts?: boolean;
  /** Change it to replay the chart's entrance animation. */
  animateKey?: string | number;
  onReady?: () => void;
  /**
   * Hold the chart back until the frame scrolls into view, so its entrance
   * animation is seen rather than played off screen.
   */
  waitUntilVisible?: boolean;
  className?: string;
}

/**
 * The one place the page touches the chart component. The frame reserves the
 * height the chart is about to pick for itself (the `.chart-frame` rules in
 * app/globals.css mirror `pickSankeyHeight`), so nothing below it jumps while
 * the chart measures its container.
 */
export function ChartFrame({
  graph,
  hideAmounts = false,
  animateKey,
  onReady,
  waitUntilVisible = false,
  className,
}: ChartFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.2 });
  return (
    <div ref={ref} className={cx("chart-frame", className)}>
      <div className="chart-frame-inner">
        {(seen || !waitUntilVisible) && (
          <SankeyChart graph={graph} hideAmounts={hideAmounts} animateKey={animateKey} onReady={onReady} />
        )}
      </div>
    </div>
  );
}
