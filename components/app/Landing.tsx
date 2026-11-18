"use client";

import type { ReactNode } from "react";
import type { ParseIssue } from "@/lib/flume/types";
import { ImportBox } from "./ImportBox";
import { LandingInfo } from "./LandingInfo";
import { ChevronDownIcon, LockIcon } from "./icons";
import { PromptStep } from "./PromptStep";
import { SamplePreview } from "./SamplePreview";

function Step({ n, title, lead, children }: { n: string; title: string; lead: string; children: ReactNode }) {
  return (
    <li className="border-t border-border pt-5">
      <div className="flex items-baseline gap-3">
        <span aria-hidden="true" className="font-mono text-[12px] text-text-faint tabular-nums">
          {n}
        </span>
        <h2 className="text-[17px] leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
      </div>
      <p className="mt-1.5 text-[14.5px] leading-[1.55] text-text-muted">{lead}</p>
      <div className="mt-4">{children}</div>
    </li>
  );
}

export interface LandingProps {
  periodId: string;
  onPeriodChange: (periodId: string) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  issues: ParseIssue[];
  /** Text that arrived whole (pasted or read from the clipboard). */
  onArrive: (text: string) => void;
  onFile: (file: File) => void;
  /** Draw from the hand-edited draft. */
  onSubmit: () => void;
  onSample: () => void;
}

/** State 1: nothing loaded yet. */
export function Landing({
  periodId,
  onPeriodChange,
  draft,
  onDraftChange,
  issues,
  onArrive,
  onFile,
  onSubmit,
  onSample,
}: LandingProps) {
  return (
    <div className="mx-auto w-full max-w-[1360px] page-x pb-10 sm:pb-12">
      {/* On wide screens the hero fills the first screen (minus the 72px
          header) with its content centered, so the rest of the page starts
          below the fold; the arrow at the bottom says there is more. */}
      <section className="flex flex-col pt-5 sm:pt-8 lg:min-h-[calc(100svh-72px)] lg:pt-2">
        <div className="grid gap-x-16 gap-y-12 lg:my-auto lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] xl:gap-x-20">
        <div className="min-w-0">
          <h1 className="text-[36px] leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-[46px]">
            See where your money went.
          </h1>

          <ol className="mt-8 max-w-[35rem] space-y-7 sm:mt-10">
            <Step
              n="01"
              title="Ask your agent"
              lead="Give this prompt to ChatGPT, Claude, or any agent that can see your transactions. It replies with a short table of totals."
            >
              <PromptStep periodId={periodId} onPeriodChange={onPeriodChange} />
            </Step>

            <Step
              n="02"
              title="Bring the answer back"
              lead="Paste the whole reply. Flume finds the table inside it."
            >
              <ImportBox
                value={draft}
                onChange={onDraftChange}
                issues={issues}
                onArrive={onArrive}
                onFile={onFile}
                onSubmit={onSubmit}
                submitLabel="Draw chart"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p className="flex items-center gap-1.5 text-[13px] leading-5 text-text-muted">
                  <LockIcon size={14} />
                  Read on this device only
                </p>
                <p className="text-[13px] leading-5 text-text-muted">
                  No agent handy?{" "}
                  <button
                    type="button"
                    onClick={onSample}
                    className="-my-3 rounded-md py-3 font-medium text-text underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-text"
                  >
                    Try a sample
                  </button>
                </p>
              </div>
            </Step>
          </ol>
        </div>

        <SamplePreview onOpen={onSample} className="self-start lg:sticky lg:top-6" />
        </div>

        <a
          href="#about"
          aria-label="More about Flume"
          onClick={(event) => {
            const target = document.getElementById("about");
            if (!target) return;
            event.preventDefault();
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
          }}
          className="mx-auto mt-4 mb-3 hidden size-11 shrink-0 items-center justify-center rounded-full text-text-faint transition-colors hover:text-text lg:flex"
        >
          <ChevronDownIcon size={22} className="scroll-hint" />
        </a>
      </section>

      <LandingInfo />
    </div>
  );
}
