"use client";

import { useCallback, useSyncExternalStore } from "react";
import { flumeStore, type FlumeState } from "@/lib/storage";

/**
 * Live result of a media query. False on the server and during hydration,
 * so only use it for things that are not in the server-rendered HTML (or
 * that may settle a moment after load).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Narrower than Tailwind's `sm` breakpoint: the phone layout. */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 639.98px)");
}

/**
 * The visitor asked for less motion. (Motion's own hook logs a warning in
 * development whenever this is true; this one just answers.)
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** The saved state (see lib/storage.ts). `hydrated` is false until it has been read. */
export function useFlumeState(): FlumeState {
  return useSyncExternalStore(flumeStore.subscribe, flumeStore.getSnapshot, flumeStore.getServerSnapshot);
}
