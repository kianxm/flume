"use client";

import { useEffect, useRef, useState } from "react";
import type { ParseIssue } from "@/lib/flume/types";
import { readImportFile } from "@/lib/import-file";
import { ImportBox } from "./ImportBox";
import { CloseIcon } from "./icons";
import { Button, IconButton } from "./ui";

export interface EditDialogProps {
  /** Text to start from. Remount the dialog (change its key) to load new text. */
  initialText: string;
  initialIssues?: ParseIssue[];
  /**
   * Try to draw from the text. Returns the problems, or null when the chart
   * was redrawn (the parent then closes the dialog).
   */
  onRedraw: (text: string) => ParseIssue[] | null;
  onClose: () => void;
}

/** "Edit data": the same input as the landing page, holding the current text. */
export function EditDialog({ initialText, initialIssues = [], onRedraw, onClose }: EditDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initialText);
  const [issues, setIssues] = useState<ParseIssue[]>(initialIssues);

  useEffect(() => {
    const dialog = ref.current;
    // No close() on cleanup: it would fire a "close" event (and so onClose)
    // when React re-runs effects in development. Unmounting removes the
    // dialog from the top layer by itself.
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // With a keyboard at hand, start in the text. On a phone that would
    // throw the on-screen keyboard over the data before it has been seen.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const field = dialog.querySelector("textarea");
      field?.focus();
      field?.setSelectionRange(0, 0);
      if (field) field.scrollTop = 0;
    }
  }, []);

  const redraw = (value: string) => {
    const problems = onRedraw(value);
    if (problems) setIssues(problems);
  };

  const handleFile = async (file: File) => {
    const read = await readImportFile(file);
    if (!read.ok) {
      setIssues([{ level: "error", message: read.message }]);
      return;
    }
    setText(read.text);
    redraw(read.text);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="edit-data-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="sheet m-auto h-dvh max-h-none w-full max-w-none bg-bg p-0 sm:h-fit sm:max-h-[calc(100dvh-48px)] sm:w-[min(720px,calc(100vw-48px))] sm:rounded-[20px] sm:border sm:border-border sm:shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          redraw(text);
        }}
        className="flex h-full flex-col pt-[env(safe-area-inset-top)] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] sm:p-6 sm:pt-5"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="edit-data-title" className="text-[19px] leading-7 font-semibold tracking-[-0.02em]">
            Edit your data
          </h2>
          <IconButton aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2.5">
            <CloseIcon />
          </IconButton>
        </div>
        <p className="mt-1 mb-4 max-w-[36rem] text-[14px] leading-[1.55] text-text-muted">
          Fix a number or a name, then redraw. One line per total: type, category, subcategory, amount.
        </p>

        <div className="min-h-0 flex-1 sm:flex-none">
          <ImportBox
            value={text}
            onChange={(value) => {
              setText(value);
              if (issues.length) setIssues([]);
            }}
            issues={issues}
            onFile={handleFile}
            onSubmit={() => redraw(text)}
            size="tall"
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => ref.current?.close()} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button variant="primary" type="submit" className="flex-1 sm:flex-none">
            Redraw chart
          </Button>
        </div>
      </form>
    </dialog>
  );
}
