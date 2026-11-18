"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { PROMPT_PERIODS, buildAgentPrompt } from "@/lib/flume/prompt";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "./icons";
import { Button, Collapse, cx } from "./ui";

/** The line under the buttons. It stays put once shown, so nothing jumps back. */
type Note = "none" | "copied" | "blocked";

export interface PromptStepProps {
  periodId: string;
  onPeriodChange: (periodId: string) => void;
}

/** Step 1: pick a period, copy the prompt, optionally read it first. */
export function PromptStep({ periodId, onPeriodChange }: PromptStepProps) {
  const groupName = useId();
  const panelId = useId();
  const prompt = useMemo(() => buildAgentPrompt(periodId), [periodId]);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<Note>("none");
  const [open, setOpen] = useState(false);
  const promptRef = useRef<HTMLPreElement>(null);
  const selectWhenShown = useRef(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const selectPrompt = () => {
    const el = promptRef.current;
    if (!el) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.addRange(range);
  };

  const copy = async () => {
    const ok = await copyText(prompt);
    if (ok) {
      setCopied(true);
      setNote("copied");
      return;
    }
    // Nothing reached the clipboard: show the prompt, selected, so it can be
    // copied by hand.
    setNote("blocked");
    if (open) selectPrompt();
    else {
      selectWhenShown.current = true;
      setOpen(true);
    }
  };

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Period to cover</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PROMPT_PERIODS.map((period) => {
            const checked = period.id === periodId;
            return (
              <label
                key={period.id}
                className={cx(
                  "flex h-11 cursor-pointer items-center justify-center rounded-[10px] border px-2 text-[14px] whitespace-nowrap transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent sm:h-10 sm:text-[13.5px]",
                  checked
                    ? "border-text bg-surface font-medium text-text"
                    : "border-border text-text-muted hover:border-border-strong hover:text-text",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={period.id}
                  checked={checked}
                  onChange={() => {
                    onPeriodChange(period.id);
                    setCopied(false);
                  }}
                  className="sr-only"
                />
                {period.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button variant="primary" onClick={copy} className="min-w-[148px]">
          {copied ? <CheckIcon size={17} /> : <CopyIcon size={17} />}
          {copied ? "Copied" : "Copy prompt"}
        </Button>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="px-3"
        >
          {open ? "Hide the prompt" : "Read it first"}
          <ChevronDownIcon
            size={16}
            className={cx("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
          />
        </Button>
      </div>

      <p role="status" className={cx("text-[13px] leading-5 text-text-muted", note === "none" ? "sr-only" : "mt-2.5")}>
        {note === "copied" && "Copied. Paste it into your agent, then bring its reply back here."}
        {note === "blocked" &&
          "Your browser blocked the copy. The prompt is selected below, so you can copy it by hand."}
      </p>

      <Collapse open={open} id={panelId}>
        <div className="pt-3">
          <pre
            ref={(el) => {
              promptRef.current = el;
              if (el && selectWhenShown.current) {
                selectWhenShown.current = false;
                selectPrompt();
              }
            }}
            tabIndex={0}
            aria-label="The prompt for your agent"
            className="max-h-[320px] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface px-4 py-3.5 font-mono text-[12.5px] leading-[1.7] break-words whitespace-pre-wrap text-text-muted"
          >
            {prompt}
          </pre>
        </div>
      </Collapse>
    </div>
  );
}
