"use client";

import { useId, useRef, useState } from "react";
import { PencilIcon } from "./icons";

const TYPE =
  "py-[7px] text-[26px] leading-[1.2] font-semibold tracking-[-0.03em] whitespace-pre-wrap [overflow-wrap:anywhere] sm:py-0.5 sm:text-[30px] xl:text-[28px]";

export interface TitleFieldProps {
  value: string;
  /** Called when editing ends (blur or Enter) with the trimmed text. */
  onCommit: (value: string) => void;
}

/**
 * The chart title, editable in place. An empty title is allowed. Long titles
 * wrap instead of being cut off: the field is a textarea that grows with its
 * hidden twin. The vertical padding makes it a 44px target on phones.
 */
export function TitleField({ value, onCommit }: TitleFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = draft ?? value;

  return (
    <div className="group flex min-w-0 items-start gap-1">
      {/* The hidden twin sizes the grid cell, so the field hugs its text. */}
      <span className="inline-grid max-w-full min-w-0">
        <span aria-hidden="true" className={`invisible col-start-1 row-start-1 pr-1 ${TYPE}`}>
          {/* A trailing space keeps the caret's line from collapsing. */}
          {(shown || "Add a title") + " "}
        </span>
        <textarea
          id={id}
          rows={1}
          cols={1}
          value={shown}
          placeholder="Add a title"
          aria-label="Chart title"
          maxLength={80}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value.replace(/\s*\n\s*/g, " "))}
          onFocus={() => {
            cancelled.current = false;
          }}
          onBlur={() => {
            if (draft !== null && !cancelled.current) onCommit(draft.trim());
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
          className={`col-start-1 row-start-1 block h-full w-full min-w-0 resize-none overflow-hidden bg-transparent text-text outline-none placeholder:text-text-faint focus-visible:shadow-[inset_0_-2px_0_var(--accent)] ${TYPE}`}
        />
      </span>
      <label
        htmlFor={id}
        title="Rename"
        className="flex h-11 w-9 shrink-0 cursor-text items-center justify-center text-text-faint transition-colors duration-150 group-focus-within:text-accent group-hover:text-text-muted sm:h-10"
      >
        <PencilIcon size={16} />
      </label>
    </div>
  );
}
