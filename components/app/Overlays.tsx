"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePrefersReducedMotion } from "./hooks";
import { UploadIcon } from "./icons";

/** Covers the page while a file is dragged over it: the whole window is the target. */
export function DropOverlay({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="drop"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="pointer-events-none fixed inset-0 z-50 bg-bg/85 p-3 backdrop-blur-[3px] sm:p-5"
        >
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed border-accent text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <UploadIcon size={22} />
            </span>
            <p className="text-[22px] leading-7 font-semibold tracking-[-0.02em]">Drop it to draw your chart</p>
            <p className="text-[14px] text-text-muted">A .csv or .txt file. It is read here, in your browser.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface ToastState {
  /** Changes with every new toast, so the timer and the animation restart. */
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

/** One quiet line at the bottom of the screen, optionally with an action. */
export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const calm = usePrefersReducedMotion();
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(5.75rem,calc(env(safe-area-inset-bottom)+5.75rem))] sm:pb-8"
    >
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: calm ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: calm ? 0 : 4 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto flex max-w-full items-center gap-1 rounded-[14px] bg-text py-1 pr-1 pl-4 text-[14px] leading-5 text-bg shadow-[0_8px_30px_rgba(0,0,0,0.22)]"
          >
            <span className="min-w-0 py-2">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  onDismiss();
                }}
                className="h-10 shrink-0 rounded-[10px] px-3 font-semibold underline decoration-bg/40 underline-offset-[3px] hover:decoration-bg focus-visible:outline-bg"
              >
                {toast.action.label}
              </button>
            ) : (
              <span className="w-3" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
