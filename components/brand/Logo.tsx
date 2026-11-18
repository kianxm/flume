import type { CSSProperties } from "react";
import {
  MARK_BODY_PATH,
  MARK_FLOW_PATH,
  MARK_VIEWBOX,
  WORDMARK,
} from "@/lib/brand";

export interface LogoProps {
  /** Height of the mark in px. Default 24. */
  size?: number;
  className?: string;
  /**
   * "duo" (default): body in the current text color, flow in the accent.
   * "mono": everything in currentColor, for single-color contexts.
   */
  variant?: "duo" | "mono";
}

function MarkSvg({
  size,
  variant,
  className,
  label,
}: {
  size: number;
  variant: "duo" | "mono";
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      className={className}
      style={{ flex: "none", display: "block" }}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true, focusable: false })}
    >
      {/* Flow first: the body overlaps its left end so no seam shows. */}
      <path
        d={MARK_FLOW_PATH}
        fill={variant === "duo" ? "var(--accent)" : "currentColor"}
      />
      <path d={MARK_BODY_PATH} fill="currentColor" />
    </svg>
  );
}

/** The Flume mark alone. Named "Flume" for assistive tech. */
export function LogoMark({ size = 24, className, variant = "duo" }: LogoProps) {
  return (
    <MarkSvg size={size} variant={variant} className={className} label="Flume" />
  );
}

/** Mark plus the "Flume" wordmark, as live text in Geist. */
export function Logo({ size = 24, className, variant = "duo" }: LogoProps) {
  const wordStyle: CSSProperties = {
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
    fontSize: size * WORDMARK.fontSize,
    fontWeight: WORDMARK.fontWeight,
    letterSpacing: `${WORDMARK.letterSpacing}em`,
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: size,
        gap: size * WORDMARK.gap,
      }}
    >
      <MarkSvg size={size} variant={variant} />
      <span style={wordStyle}>{WORDMARK.text}</span>
    </span>
  );
}
