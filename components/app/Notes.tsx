"use client";

import { useId, useState } from "react";
import type { ParseIssue } from "@/lib/flume/types";
import { ChevronDownIcon } from "./icons";
import { Collapse, cx } from "./ui";

/** Parser warnings, tucked behind a quiet disclosure. Renders nothing when there are none. */
export function Notes({ issues, className }: { issues: ParseIssue[]; className?: string }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const notes = issues.filter((issue) => issue.level === "warning");
  if (notes.length === 0) return null;

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="-ml-2 inline-flex h-11 items-center gap-2 rounded-[10px] px-2 text-[13.5px] text-text-muted transition-colors duration-150 hover:text-text sm:h-9"
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
        {notes.length === 1 ? "1 note about your data" : `${notes.length} notes about your data`}
        <ChevronDownIcon
          size={15}
          className={cx("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>
      <Collapse open={open} id={panelId}>
        <ul className="max-w-[46rem] space-y-2 pt-1 pb-2 text-[13.5px] leading-[1.55] text-text-muted">
          {notes.map((note, i) => (
            // The parser's messages already say which line they are about.
            <li key={i} className="relative pl-3.5 before:absolute before:top-[0.7em] before:left-0 before:h-px before:w-1.5 before:bg-text-faint">
              {note.message}
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}
