"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { readClipboardText } from "@/lib/clipboard";
import type { ParseIssue } from "@/lib/flume/types";
import { ClipboardIcon, UploadIcon } from "./icons";
import { Button, cx } from "./ui";

/** File types the picker offers. Drops are checked separately, by content. */
export const IMPORT_ACCEPT = ".csv,.txt,.tsv,.md,text/csv,text/plain";

export interface ImportBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** Problems with the last attempt, shown under the box. */
  issues: ParseIssue[];
  /**
   * Text that arrived in one piece: pasted into the empty box, or brought in
   * with the Paste button. When given, the parent decides what happens (the
   * landing page draws the chart straight away). When omitted, the text just
   * lands in the box for editing.
   */
  onArrive?: (text: string) => void;
  onFile: (file: File) => void;
  /** Draw from what is in the box (the button, or Cmd/Ctrl+Enter). */
  onSubmit: () => void;
  /** Label for the in-box draw button. Omit it when the parent has its own. */
  submitLabel?: string;
  /** "tall" fills an editing sheet; "compact" sits in the landing column. */
  size?: "compact" | "tall";
}

export function ImportBox({
  value,
  onChange,
  issues,
  onArrive,
  onFile,
  onSubmit,
  submitLabel,
  size = "compact",
}: ImportBoxProps) {
  const id = useId();
  const errorId = `${id}-errors`;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [clipboardBlocked, setClipboardBlocked] = useState(false);

  const errors = issues.filter((issue) => issue.level === "error");
  const hasText = value.trim() !== "";
  const hasErrors = errors.length > 0;
  const tall = size === "tall";

  // A paste or drop can fail while the box is off screen: bring the
  // explanation into view.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!issues.some((issue) => issue.level === "error")) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [issues]);

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onArrive) return;
    const el = event.currentTarget;
    const replacesEverything = value.trim() === "" || (el.selectionStart === 0 && el.selectionEnd === value.length);
    if (!replacesEverything) return; // A small edit inside existing text: leave it alone.
    const text = event.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    event.preventDefault();
    onArrive(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && hasText) {
      event.preventDefault();
      onSubmit();
    }
  };

  const pasteFromClipboard = async () => {
    const text = await readClipboardText();
    if (text === null || !text.trim()) {
      // No permission, no support, or nothing there: point at the box instead.
      setClipboardBlocked(text === null);
      textRef.current?.focus();
      return;
    }
    setClipboardBlocked(false);
    if (onArrive) onArrive(text);
    else onChange(text);
  };

  return (
    <div ref={rootRef} className={cx("scroll-my-6", tall && "flex h-full flex-col")}>
      <div
        className={cx(
          tall && "flex min-h-0 flex-1 flex-col",
          "rounded-2xl border bg-surface transition-colors duration-150 has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2",
          // In the error state the focus ring takes the error color, so the box
          // never shows a red border inside a teal ring.
          hasErrors
            ? "border-danger has-[textarea:focus-visible]:outline-danger"
            : "border-border-strong has-[textarea:focus-visible]:outline-accent",
        )}
      >
        <div className={cx("relative", tall && "flex min-h-0 flex-1 flex-col")}>
          <label htmlFor={id} className="sr-only">
            Your agent&rsquo;s reply
          </label>
          <textarea
            id={id}
            ref={textRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            aria-invalid={hasErrors || undefined}
            aria-describedby={hasErrors ? errorId : undefined}
            className={cx(
              // 16px on phones: anything smaller makes iOS zoom the page on focus.
              // At that size the sans face fits a whole CSV row on a line; mono
              // takes over where there is room for it.
              "block w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3.5 pb-2 font-sans text-[16px] leading-[1.55] text-text tabular-nums outline-none sm:font-mono sm:text-[13px] sm:leading-[1.65]",
              // In the sheet the field takes whatever height the phone has left.
              tall ? "min-h-[120px] flex-1 sm:h-[min(52dvh,460px)] sm:flex-none" : "h-[120px]",
            )}
          />
          {!hasText && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-3.5 select-none">
              <p className="text-[15px] leading-6 text-text-muted">Paste your agent&rsquo;s reply here</p>
              <p className="mt-0.5 text-[13px] leading-5 text-text-faint">
                <span className="hidden sm:inline">or drop a .csv file anywhere on this page</span>
                <span className="sm:hidden">or choose the file it gave you</span>
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 px-1.5 pb-1.5 sm:px-2 sm:pb-2">
          {hasText ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange("");
                textRef.current?.focus();
              }}
            >
              Clear
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={pasteFromClipboard}>
              <ClipboardIcon size={16} />
              Paste
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <UploadIcon size={16} />
            Choose a file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so choosing the same file twice still fires a change.
              event.target.value = "";
              if (file) onFile(file);
            }}
          />
          <span className="flex-1" />
          {submitLabel && hasText && (
            <Button variant="primary" size="sm" onClick={onSubmit}>
              {submitLabel}
            </Button>
          )}
        </div>
      </div>

      {hasErrors ? (
        <div id={errorId} role="alert" className="mt-3 max-h-[40dvh] shrink-0 overflow-y-auto border-l-2 border-danger pl-3.5 sm:max-h-none">
          <p className="text-[13.5px] font-medium text-danger">Flume couldn&rsquo;t draw that yet</p>
          <ul className="mt-1 space-y-1.5 text-[13.5px] leading-[1.55] text-text">
            {errors.map((issue, i) => (
              // The parser's messages already name the line when it matters.
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        clipboardBlocked && (
          <p role="status" className="mt-3 text-[13px] leading-5 text-text-muted">
            This browser keeps the clipboard to itself. Click in the box and paste there instead.
          </p>
        )
      )}
    </div>
  );
}
