"use client";

import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Variants,
} from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildGraph } from "@/lib/flume/graph";
import { parseFlumeInput } from "@/lib/flume/parse";
import { SAMPLE_CSV } from "@/lib/flume/sample";
import type {
  Detail,
  ExportFormat,
  FlumeGraph,
  ParseIssue,
} from "@/lib/flume/types";
import { readImportFile } from "@/lib/import-file";
import { flumeStore } from "@/lib/storage";
import { ChartView } from "./ChartView";
import { EditDialog } from "./EditDialog";
import { Header } from "./Header";
import { useFlumeState, useIsPhone, usePrefersReducedMotion } from "./hooks";
import { Landing } from "./Landing";
import { DropOverlay, Toast, type ToastState } from "./Overlays";

/** How new text reached the page. A stray paste is treated more gently than a drop. */
type Route = "paste" | "drop" | "file";

interface EditorState {
  /** Remounts the dialog when new text is pushed into it. */
  key: number;
  text: string;
  issues: ParseIssue[];
}

interface StageMotion {
  /** Skip the transition altogether (the restore after a refresh). */
  instant: boolean;
  /** The visitor prefers reduced motion: fade only, no movement. */
  calm: boolean;
}

/** Quiet cross-fade between the two states, steered by `custom`. */
const STAGE_VARIANTS: Variants = {
  enter: ({ instant, calm }: StageMotion) =>
    instant ? { opacity: 1, y: 0 } : { opacity: 0, y: calm ? 0 : 10 },
  shown: ({ instant }: StageMotion) => ({
    opacity: 1,
    y: 0,
    transition: { duration: instant ? 0 : 0.28, ease: [0.2, 0.8, 0.2, 1] },
  }),
  exit: ({ instant }: StageMotion) => ({
    opacity: 0,
    transition: { duration: instant ? 0 : 0.16, ease: "easeOut" },
  }),
};

function errorsOf(issues: ParseIssue[]): ParseIssue[] {
  const errors = issues.filter((issue) => issue.level === "error");
  return errors.length > 0
    ? errors
    : [
        {
          level: "error",
          message:
            "Flume couldn't find any data in that. Paste the CSV from your agent's reply.",
        },
      ];
}

function isTextEntry(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (
    node.isContentEditable ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  )
    return true;
  return (
    node instanceof HTMLInputElement &&
    !["button", "checkbox", "radio", "file", "range"].includes(node.type)
  );
}

function clearRestoreFlag() {
  delete document.documentElement.dataset.flumeRestore;
}

export function FlumeApp() {
  const state = useFlumeState();
  const phone = useIsPhone();
  const calm = usePrefersReducedMotion();

  const parsed = useMemo(
    () => (state.text ? parseFlumeInput(state.text) : null),
    [state.text],
  );
  const data = parsed?.data ?? null;
  const stage = data ? "chart" : "landing";

  // What is in the landing input when it could not be drawn (or is being typed).
  const [draft, setDraft] = useState("");
  const [draftIssues, setDraftIssues] = useState<ParseIssue[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [animateKey, setAnimateKey] = useState(0);
  // Page transitions stay off until the person does something, so a restored
  // chart appears without the landing page fading out first.
  const [animated, setAnimated] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [dragging, setDragging] = useState(false);
  const serial = useRef(0);

  const detail: Detail = state.detail ?? (phone ? "simple" : "full");
  const format: ExportFormat =
    state.format ?? (phone ? "portrait" : "landscape");
  const title = state.title ?? data?.title ?? "";

  const graph: FlumeGraph | null = useMemo(() => {
    if (!data) return null;
    return { ...buildGraph(data, { detail }), title: title || undefined };
  }, [data, detail, title]);

  const sources = useMemo(
    () =>
      new Set(
        (data?.rows ?? [])
          .filter((row) => row.type === "income")
          .map((row) => row.category),
      ).size,
    [data],
  );

  /* The landing HTML is held back while a saved chart is on its way. */
  useEffect(() => {
    if (state.hydrated && stage === "landing") clearRestoreFlag();
  }, [state.hydrated, stage]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.action ? 8000 : 4500,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback(
    (message: string, action?: ToastState["action"]) => {
      serial.current += 1;
      setToast({ id: serial.current, message, action });
    },
    [],
  );

  /** Draws from `text`. Returns the problems, or null when the chart is up. */
  const load = useCallback(
    (text: string, opts: { keepTitle?: boolean } = {}): ParseIssue[] | null => {
      const result = parseFlumeInput(text);
      if (!result.data) return errorsOf(result.issues);
      setAnimated(true);
      flumeStore.update(opts.keepTitle ? { text } : { text, title: null });
      setAnimateKey((key) => key + 1);
      setDraft("");
      setDraftIssues([]);
      setEditor(null);
      setToast(null);
      return null;
    },
    [],
  );

  /** Text that arrived whole. Clean data goes straight to the chart. */
  const receive = useCallback(
    (text: string, route: Route) => {
      const problems = load(text);
      if (!problems) return;
      if (stage === "landing") {
        setDraft(text);
        setDraftIssues(problems);
      } else if (route === "paste") {
        // A stray Cmd+V should not disturb the chart that is already there.
        showToast(
          "That paste didn’t contain Flume data, so the chart was left alone.",
        );
      } else {
        serial.current += 1;
        setEditor({ key: serial.current, text, issues: problems });
      }
    },
    [load, showToast, stage],
  );

  const receiveFile = useCallback(
    async (file: File, route: Route) => {
      const read = await readImportFile(file);
      if (read.ok) {
        receive(read.text, route);
        return;
      }
      const problem: ParseIssue = { level: "error", message: read.message };
      if (stage === "landing") setDraftIssues([problem]);
      else if (route === "paste")
        showToast(
          "That paste wasn’t something Flume can read, so the chart was left alone.",
        );
      else {
        serial.current += 1;
        setEditor((current) => ({
          key: serial.current,
          text: current?.text ?? state.text,
          issues: [problem],
        }));
      }
    },
    [receive, showToast, stage, state.text],
  );

  /* Paste and drop anywhere on the page. */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isTextEntry(document.activeElement)) return;
      if (document.querySelector("dialog[open]")) return;
      // Text first: spreadsheets put a picture of the cells on the clipboard
      // next to the text, and the text is the part Flume can read.
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.trim()) {
        event.preventDefault();
        receive(text, "paste");
        return;
      }
      const file = event.clipboardData?.files?.[0];
      if (file) {
        event.preventDefault();
        void receiveFile(file, "paste");
      }
    };

    let depth = 0;
    const kinds = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []);
    const carriesFile = (event: DragEvent) => kinds(event).includes("Files");
    const carriesText = (event: DragEvent) =>
      kinds(event).includes("text/plain") && !isTextEntry(event.target);

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFile(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!carriesFile(event) && !carriesText(event)) return;
      event.preventDefault(); // Required, or the browser refuses the drop.
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFile(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        event.preventDefault(); // Otherwise the browser navigates to the file.
        void receiveFile(file, "drop");
        return;
      }
      if (!carriesText(event)) return;
      const text = event.dataTransfer?.getData("text/plain") ?? "";
      if (!text.trim()) return;
      event.preventDefault();
      receive(text, "drop");
    };

    document.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [receive, receiveFile]);

  const startOver = () => {
    const before = flumeStore.getSnapshot();
    setAnimated(true);
    setEditor(null);
    setDraft("");
    setDraftIssues([]);
    flumeStore.clear();
    showToast("Chart cleared from this browser.", {
      label: "Undo",
      run: () => {
        flumeStore.restore(before);
        setAnimateKey((key) => key + 1);
      },
    });
  };

  const openEditor = () => {
    serial.current += 1;
    setEditor({ key: serial.current, text: state.text, issues: [] });
  };

  const stageMotion: StageMotion = { instant: !animated, calm };

  return (
    // Reduced motion is handled by hand (see `calm`), so nothing is left to
    // the library's blanket switch.
    <MotionConfig reducedMotion="never">
      <div className="flex min-h-dvh flex-col">
        <Header onStartOver={stage === "chart" ? startOver : undefined} />
        <main className="flex flex-1 flex-col">
          <AnimatePresence
            mode="wait"
            initial={false}
            custom={stageMotion}
            onExitComplete={() => {
              clearRestoreFlag();
              window.scrollTo(0, 0);
            }}
          >
            {stage === "chart" && graph ? (
              <motion.div
                key="chart"
                data-stage="chart"
                custom={stageMotion}
                variants={STAGE_VARIANTS}
                initial="enter"
                animate="shown"
                exit="exit"
                className="flex flex-1 flex-col"
              >
                <ChartView
                  graph={graph}
                  sources={sources}
                  issues={parsed?.issues ?? []}
                  title={title}
                  onTitleChange={(next) =>
                    flumeStore.update({
                      title: next === (data?.title ?? "") ? null : next,
                    })
                  }
                  detail={detail}
                  onDetailChange={(next) => flumeStore.update({ detail: next })}
                  hideAmounts={state.hideAmounts}
                  onHideAmountsChange={(next) =>
                    flumeStore.update({ hideAmounts: next })
                  }
                  format={format}
                  onFormatChange={(next) => flumeStore.update({ format: next })}
                  animateKey={animateKey}
                  onReplay={() => setAnimateKey((key) => key + 1)}
                  onEdit={openEditor}
                  focusOnMount={animated}
                />
              </motion.div>
            ) : (
              <motion.div
                key="landing"
                data-stage="landing"
                custom={stageMotion}
                variants={STAGE_VARIANTS}
                initial="enter"
                animate="shown"
                exit="exit"
              >
                <Landing
                  periodId={state.periodId}
                  onPeriodChange={(periodId) => flumeStore.update({ periodId })}
                  draft={draft}
                  onDraftChange={(text) => {
                    setDraft(text);
                    if (draftIssues.length) setDraftIssues([]);
                  }}
                  issues={draftIssues}
                  onArrive={(text) => receive(text, "paste")}
                  onFile={(file) => void receiveFile(file, "file")}
                  onSubmit={() => {
                    const problems = load(draft);
                    if (problems) setDraftIssues(problems);
                  }}
                  onSample={() => load(SAMPLE_CSV)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {editor && stage === "chart" && (
        <EditDialog
          key={editor.key}
          initialText={editor.text}
          initialIssues={editor.issues}
          onRedraw={(text) => load(text, { keepTitle: true })}
          onClose={() => setEditor(null)}
        />
      )}
      <DropOverlay active={dragging} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </MotionConfig>
  );
}
