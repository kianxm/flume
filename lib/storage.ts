import { DEFAULT_PERIOD_ID, PROMPT_PERIODS } from "./flume/prompt";
import type { Detail, ExportFormat } from "./flume/types";

/**
 * Everything Flume remembers between visits, kept in localStorage and nowhere
 * else. A tiny external store (for useSyncExternalStore) so the server render
 * and the first client render agree, and the saved chart appears right after
 * hydration without a mismatch warning.
 */

export const STATE_STORAGE_KEY = "flume-state";

/** Anything larger is not a category summary; don't fill storage with it. */
const MAX_STORED_TEXT = 400_000;

export interface FlumeState {
  /** False on the server and during hydration; true once storage was read. */
  hydrated: boolean;
  /** The text the current chart was drawn from. Empty when there is none. */
  text: string;
  /** The user's own title. Null means "use the title in the data". */
  title: string | null;
  /** An explicit detail choice. Null means "pick by screen width". */
  detail: Detail | null;
  hideAmounts: boolean;
  /** An explicit export format. Null means "pick by screen width". */
  format: ExportFormat | null;
  /** Period selected for the agent prompt. */
  periodId: string;
}

export type FlumeStatePatch = Partial<Omit<FlumeState, "hydrated">>;

const EMPTY: FlumeState = {
  hydrated: false,
  text: "",
  title: null,
  detail: null,
  hideAmounts: false,
  format: null,
  periodId: DEFAULT_PERIOD_ID,
};

let state: FlumeState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function read(): FlumeState {
  const next: FlumeState = { ...EMPTY, hydrated: true };
  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return next;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return next;
    const s = saved as Record<string, unknown>;
    if (typeof s.text === "string") next.text = s.text;
    if (typeof s.title === "string") next.title = s.title;
    if (s.detail === "simple" || s.detail === "full") next.detail = s.detail;
    if (typeof s.hideAmounts === "boolean") next.hideAmounts = s.hideAmounts;
    if (s.format === "landscape" || s.format === "portrait") next.format = s.format;
    if (typeof s.periodId === "string" && PROMPT_PERIODS.some((p) => p.id === s.periodId)) {
      next.periodId = s.periodId;
    }
  } catch {
    // Blocked storage or a corrupt entry: start fresh.
  }
  return next;
}

function write(next: FlumeState) {
  try {
    const isDefault =
      !next.text &&
      next.title === null &&
      next.detail === null &&
      !next.hideAmounts &&
      next.format === null &&
      next.periodId === DEFAULT_PERIOD_ID;
    if (isDefault) {
      window.localStorage.removeItem(STATE_STORAGE_KEY);
      return;
    }
    const { text, title, detail, hideAmounts, format, periodId } = next;
    window.localStorage.setItem(
      STATE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        text: text.length <= MAX_STORED_TEXT ? text : "",
        title,
        detail,
        hideAmounts,
        format,
        periodId,
      }),
    );
  } catch {
    // Private mode or a full quota: the chart still works, it just won't
    // survive a refresh.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  // Another tab changed (or cleared) the saved chart: follow it.
  if (event.key !== null && event.key !== STATE_STORAGE_KEY) return;
  state = read();
  emit();
}

export const flumeStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): FlumeState {
    if (!loaded) {
      loaded = true;
      state = read();
    }
    return state;
  },
  getServerSnapshot(): FlumeState {
    return EMPTY;
  },
  update(patch: FlumeStatePatch) {
    const current = flumeStore.getSnapshot();
    state = { ...current, ...patch, hydrated: true };
    write(state);
    emit();
  },
  /** Forget everything, including view preferences. */
  clear() {
    state = { ...EMPTY, hydrated: true };
    write(state);
    emit();
  },
  /** Put back a snapshot taken before `clear()` (the Undo after Start over). */
  restore(snapshot: FlumeState) {
    state = { ...snapshot, hydrated: true };
    write(state);
    emit();
  },
};
