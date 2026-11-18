"use client";

import { useEffect, useState } from "react";
import { exportFileName, exportPng, saveImage } from "@/lib/flume/export";
import type { ExportFormat, FlumeGraph } from "@/lib/flume/types";
import { useTheme } from "@/lib/use-theme";
import { CheckIcon, DownloadIcon, LandscapeIcon, PortraitIcon, SpinnerIcon } from "./icons";
import { Button, Segmented, cx } from "./ui";

type Status = "idle" | "working" | "shared" | "downloaded" | "failed";

const FORMATS = [
  { value: "landscape", label: "Landscape", icon: <LandscapeIcon size={17} /> },
  { value: "portrait", label: "Portrait", icon: <PortraitIcon size={17} /> },
] as const;

export interface ExportControlProps {
  graph: FlumeGraph;
  hideAmounts: boolean;
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  className?: string;
}

/** The primary action: pick a shape, export the PNG, hand it to the device. */
export function ExportControl({ graph, hideAmounts, format, onFormatChange, className }: ExportControlProps) {
  const [theme] = useTheme();
  const [status, setStatus] = useState<Status>("idle");

  // Confirmations and the failure note clear themselves.
  useEffect(() => {
    if (status === "idle" || status === "working") return;
    const timer = window.setTimeout(() => setStatus("idle"), status === "failed" ? 7000 : 2600);
    return () => window.clearTimeout(timer);
  }, [status]);

  const run = async () => {
    if (status === "working") return;
    setStatus("working");
    try {
      const blob = await exportPng(graph, { theme, format, hideAmounts });
      const outcome = await saveImage(blob, exportFileName(graph));
      setStatus(outcome === "cancelled" ? "idle" : outcome);
    } catch {
      setStatus("failed");
    }
  };

  const working = status === "working";
  const done = status === "shared" || status === "downloaded";

  return (
    <div className={cx("flex flex-col-reverse gap-2 sm:flex-row-reverse sm:items-center sm:gap-3 xl:flex-col xl:items-stretch xl:gap-2", className)}>
      <div className="flex items-center gap-2 xl:flex-col xl:items-stretch">
        <Segmented
          label="Image shape"
          value={format}
          options={FORMATS}
          onChange={onFormatChange}
          iconsUntilLarge
        />
        <Button
          variant="primary"
          onClick={run}
          aria-disabled={working || undefined}
          aria-busy={working || undefined}
          className={cx("min-w-[144px] flex-1 sm:flex-none xl:h-11 xl:flex-auto", working && "cursor-progress")}
        >
          {working ? <SpinnerIcon size={17} /> : done ? <CheckIcon size={17} /> : <DownloadIcon size={17} />}
          {working ? "Exporting…" : status === "shared" ? "Shared" : status === "downloaded" ? "Saved" : "Export PNG"}
        </Button>
      </div>
      <p
        role="status"
        className={cx("text-[13px] leading-5 text-danger sm:text-right", status === "failed" ? "block xl:text-left" : "sr-only")}
      >
        {status === "failed" && "The image couldn’t be made this time. Try again."}
        {working && <span className="sr-only">Exporting the chart.</span>}
        {done && <span className="sr-only">The image is ready.</span>}
      </p>
    </div>
  );
}
