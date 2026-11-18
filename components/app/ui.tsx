"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./hooks";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ─────────────────────────────── Button ─────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "md" | "sm";

const BUTTON_BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-[10px] font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-text text-bg hover:bg-text/85 active:bg-text/75",
  secondary:
    "border border-border-strong bg-surface text-text hover:bg-surface-2 active:bg-surface-2",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text active:bg-surface-2",
};

// 44px tall on phones, a little tighter with a pointer.
const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: "h-11 px-4 text-[14.5px] sm:h-10 sm:text-[14px]",
  sm: "h-11 px-3 text-[14px] sm:h-9 sm:text-[13.5px]",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/** Square, icon-only. Always pass `aria-label`. */
export function IconButton({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text active:bg-surface-2 sm:h-9 sm:w-9",
        className,
      )}
      {...rest}
    />
  );
}

/* ───────────────────────────── Segmented ────────────────────────────── */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown before the label. With `iconOnly`, shown instead of it. */
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  /** Show icons alone (labels stay for screen readers) until the `lg` breakpoint. */
  iconsUntilLarge?: boolean;
  className?: string;
}

/**
 * A small either/or switch. Real radio inputs underneath, so arrow keys, Tab
 * and screen readers behave the way a radio group should.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  iconsUntilLarge = false,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const count = options.length;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("relative grid shrink-0 rounded-[10px] bg-surface-2 p-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[3px] left-[3px] rounded-[7px] bg-surface shadow-[0_1px_2px_rgba(18,21,20,0.12),0_0_0_0.5px_rgba(18,21,20,0.06)] transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-border-strong dark:shadow-none"
        style={{
          width: `calc((100% - 6px) / ${count})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => {
        const checked = option.value === value;
        return (
          // The ::after stretches the tap area over the track's padding, so
          // each segment is a full 44px tall on phones.
          <label
            key={option.value}
            className={cx(
              "relative z-10 flex h-[38px] min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13.5px] after:absolute after:-inset-y-[3px] after:inset-x-0 after:content-[''] font-medium whitespace-nowrap transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent sm:h-[30px] sm:text-[13px]",
              checked ? "text-text" : "text-text-muted hover:text-text",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
              aria-label={option.label}
            />
            {option.icon}
            <span aria-hidden="true" className={cx(iconsUntilLarge && option.icon ? "hidden lg:inline" : undefined)}>
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── Switch ─────────────────────────────── */

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/** Label and toggle as one target. */
export function Switch({ label, checked, onChange, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        "group inline-flex h-11 shrink-0 select-none items-center gap-2.5 rounded-[10px] text-[14px] font-medium text-text sm:h-9 sm:text-[13.5px]",
        className,
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-block h-[22px] w-[38px] rounded-full transition-colors duration-200",
          checked ? "bg-accent" : "bg-border-strong",
        )}
      >
        <span
          className={cx(
            "absolute top-[3px] left-[3px] h-4 w-4 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out motion-reduce:transition-none",
            checked ? "translate-x-4 bg-accent-contrast" : "bg-white dark:bg-text",
          )}
        />
      </span>
    </button>
  );
}

/* ────────────────────────────── Collapse ────────────────────────────── */

/** Height-animated container for disclosures. Unmounts its children when closed. */
export function Collapse({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  const reduce = usePrefersReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id={id}
          key="content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
