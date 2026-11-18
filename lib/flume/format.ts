/**
 * Money and percent formatting. Pure functions, safe on any input.
 */

export interface FormatMoneyOptions {
  /** `$2.2k` / `$1.3M` for tight spaces. */
  compact?: boolean;
  /** Force cents (`$2,150.00`). Without it, values of 100 or more drop them. */
  decimals?: boolean;
}

const LOCALE = "en-US";

type Formatter = (value: number, min: number, max: number) => string;

const formatterCache = new Map<string, Formatter | null>();

/** A formatter for `currency`, or null when the code is not a valid ISO code. */
function formatterFor(currency: string): Formatter | null {
  const cached = formatterCache.get(currency);
  if (cached !== undefined) return cached;
  let result: Formatter | null = null;
  try {
    // Throws RangeError for malformed codes.
    new Intl.NumberFormat(LOCALE, { style: "currency", currency });
    result = (value, min, max) =>
      new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency,
        minimumFractionDigits: min,
        maximumFractionDigits: max,
      }).format(value);
  } catch {
    result = null;
  }
  formatterCache.set(currency, result);
  return result;
}

function plain(value: number, min: number, max: number): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value);
}

function fmt(value: number, currency: string, min: number, max: number): string {
  const code = (currency ?? "").trim().toUpperCase();
  const f = /^[A-Z]{3}$/.test(code) ? formatterFor(code) : null;
  if (f) {
    try {
      return f(value, min, max);
    } catch {
      /* fall through */
    }
  }
  // Unknown currency: show the number with whatever label we were given.
  const num = plain(value, min, max);
  const label = (currency ?? "").trim();
  return label ? `${label} ${num}` : num;
}

export function formatMoney(
  value: number,
  currency: string,
  opts: FormatMoneyOptions = {},
): string {
  const v = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(v);

  if (opts.compact) {
    let scaled = v;
    let suffix = "";
    if (abs >= 999_950_000) {
      scaled = v / 1e9;
      suffix = "B";
    } else if (abs >= 999_950) {
      scaled = v / 1e6;
      suffix = "M";
    } else if (abs >= 1000) {
      scaled = v / 1e3;
      suffix = "k";
      // 999.96k would print as "1000k": roll over to millions.
      if (Math.abs(Math.round(scaled * 10) / 10) >= 1000) {
        scaled = v / 1e6;
        suffix = "M";
      }
    }
    if (suffix) return fmt(scaled, currency, 0, 1) + suffix;
    // Under 1000: whole numbers stay whole, otherwise show cents.
    const whole = Math.abs(v - Math.round(v)) < 0.005;
    return fmt(v, currency, whole ? 0 : 2, whole ? 0 : 2);
  }

  if (opts.decimals) return fmt(v, currency, 2, 2);
  if (abs >= 100) return fmt(v, currency, 0, 0);
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return whole ? fmt(v, currency, 0, 0) : fmt(v, currency, 2, 2);
}

/**
 * `part` as a share of `whole`: "12%", "0.4%", "<0.1%". Returns "0%" when
 * the share is zero or `whole` is not a positive number.
 */
export function formatPercent(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return "0%";
  }
  const pct = (Math.abs(part) / whole) * 100;
  if (pct === 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  if (pct < 1) {
    const one = Math.round(pct * 10) / 10;
    if (one < 1) return `${one}%`;
  }
  return `${Math.round(pct)}%`;
}
