/**
 * Tolerant parser for the CSV an AI agent writes for Flume.
 *
 * The input is produced by many different LLMs and then copied out of a chat
 * window by a person, so it is nearly right but messy. The job here is to
 * accept anything a reasonable person would call "the right data" and, when
 * that is impossible, to say precisely what to fix. Never throws.
 *
 * The canonical format lives in lib/flume/prompt.ts.
 */
import type {
  FlowRow,
  FlowType,
  FlumeData,
  ParseIssue,
  ParseResult,
} from "./types";

/* ───────────────────────────── Currencies ───────────────────────────── */

interface CurrencyHint {
  code: string;
  /** Other currencies that share this symbol (so "$" does not contradict "CAD"). */
  family?: string[];
}

const DOLLARS = ["USD", "CAD", "AUD", "NZD", "SGD", "HKD", "MXN", "ARS", "CLP", "COP", "TWD"];
const KRONA = ["SEK", "NOK", "DKK", "ISK"];

const SYMBOLS: Record<string, CurrencyHint> = {
  $: { code: "USD", family: DOLLARS },
  "us$": { code: "USD" },
  "€": { code: "EUR" },
  "£": { code: "GBP" },
  "¥": { code: "JPY", family: ["JPY", "CNY"] },
  "￥": { code: "JPY", family: ["JPY", "CNY"] },
  rmb: { code: "CNY" },
  "₹": { code: "INR" },
  "₩": { code: "KRW" },
  "₽": { code: "RUB" },
  "₺": { code: "TRY" },
  "₪": { code: "ILS" },
  "₫": { code: "VND" },
  "₱": { code: "PHP" },
  "₴": { code: "UAH" },
  "₦": { code: "NGN" },
  "฿": { code: "THB" },
  "r$": { code: "BRL" },
  "c$": { code: "CAD" },
  "ca$": { code: "CAD" },
  "a$": { code: "AUD" },
  "au$": { code: "AUD" },
  "nz$": { code: "NZD" },
  "hk$": { code: "HKD" },
  "s$": { code: "SGD" },
  "mx$": { code: "MXN" },
  zł: { code: "PLN" },
  zl: { code: "PLN" },
  kč: { code: "CZK" },
  kc: { code: "CZK" },
  kr: { code: "SEK", family: KRONA },
  dollar: { code: "USD", family: DOLLARS },
  dollars: { code: "USD", family: DOLLARS },
  bucks: { code: "USD", family: DOLLARS },
  euro: { code: "EUR" },
  euros: { code: "EUR" },
  pound: { code: "GBP" },
  pounds: { code: "GBP" },
};

const COMMON_CODES = new Set(
  (
    "USD EUR GBP JPY CNY CAD AUD NZD CHF SEK NOK DKK PLN CZK HUF RON BGN INR KRW SGD HKD " +
    "MXN BRL ARS CLP COP PEN ZAR TRY ILS AED SAR EGP NGN KES GHS MAD THB VND IDR MYR PHP " +
    "TWD RUB UAH ISK QAR KWD BHD OMR JOD LKR PKR BDT"
  ).split(" "),
);

let allCodes: Set<string> | null = null;
function isCurrencyCode(code: string): boolean {
  const c = code.toUpperCase();
  if (COMMON_CODES.has(c)) return true;
  if (allCodes === null) {
    allCodes = new Set();
    try {
      const intl = Intl as unknown as {
        supportedValuesOf?: (key: string) => string[];
      };
      for (const v of intl.supportedValuesOf?.("currency") ?? []) allCodes.add(v);
    } catch {
      /* older runtime: the common list is all we have */
    }
  }
  return allCodes.has(c);
}

/** Lower-case codes we also accept when written in lower case. */
const LOWER_OK = new Set(["usd", "eur", "gbp", "cad", "aud", "nzd", "chf", "jpy", "inr", "mxn", "brl", "sek", "nok", "dkk"]);

const CURRENCY_NAMES: Array<[RegExp, string]> = [
  [/canadian/i, "CAD"],
  [/australian/i, "AUD"],
  [/new zealand/i, "NZD"],
  [/hong kong/i, "HKD"],
  [/singapore/i, "SGD"],
  [/swiss|franc/i, "CHF"],
  [/\beuros?\b/i, "EUR"],
  [/pounds?|sterling/i, "GBP"],
  [/\byen\b/i, "JPY"],
  [/yuan|renminbi/i, "CNY"],
  [/rupees?/i, "INR"],
  [/\bwon\b/i, "KRW"],
  [/\b(us|u\.s\.)\s*dollars?|\bdollars?\b/i, "USD"],
];

/** Reads the value of a `# currency:` line. Returns an ISO code or undefined. */
function parseCurrencyDeclaration(raw: string): string | undefined {
  const s = raw.replace(/[*_`"]/g, "").trim();
  if (!s) return undefined;
  for (const m of s.matchAll(/\b[A-Z]{3}\b/g)) {
    if (isCurrencyCode(m[0])) return m[0];
  }
  for (const m of s.matchAll(/\b[a-z]{3}\b/g)) {
    if (LOWER_OK.has(m[0])) return m[0].toUpperCase();
  }
  for (const [re, code] of CURRENCY_NAMES) if (re.test(s)) return code;
  const syms = Object.keys(SYMBOLS).sort((a, b) => b.length - a.length);
  for (const sym of syms) {
    if (!/^[a-z]+$/i.test(sym) && s.toLowerCase().includes(sym)) return SYMBOLS[sym].code;
  }
  return undefined;
}

/** Looks at a bit of text next to a number. ok=false when it is not a currency or sign marker. */
function tokenHint(token: string): { ok: boolean; hint?: CurrencyHint } {
  const t = token.trim().replace(/\.$/, "").toLowerCase();
  if (!t) return { ok: true };
  if (t === "cr" || t === "dr") return { ok: true };
  const sym = SYMBOLS[t];
  if (sym) return { ok: true, hint: sym };
  if (/^[a-z]{3}$/.test(t) && isCurrencyCode(t)) {
    return { ok: true, hint: { code: t.toUpperCase() } };
  }
  return { ok: false };
}

/* ─────────────────────────────── Amounts ────────────────────────────── */

export interface ParsedAmount {
  /** Magnitude, rounded to cents, never negative. */
  value: number;
  negative: boolean;
  currency?: CurrencyHint;
}

/**
 * Reads a money amount the way a person would: "$1,234.56", "1 234,56",
 * "1.234,56 €", "(120.00)", "-120", "50 EUR". Returns null when the text is
 * not an amount.
 */
export function parseAmount(raw: string): ParsedAmount | null {
  let s = String(raw ?? "")
    .replace(/[      ]/g, " ")
    .replace(/[−‒–—]/g, "-")
    .replace(/[*`~≈]/g, "")
    .trim();
  if (!s) return null;
  // Spreadsheet text-prefix apostrophe: '6200
  s = s.replace(/^'(?=\S)/, "");

  const m = /\d[\d\s.,'’]*/.exec(s);
  if (!m) return null;
  const prefix = s.slice(0, m.index);
  const core = m[0].replace(/[\s.,'’]+$/, "");
  const suffix = s.slice(m.index + m[0].length);

  const negative =
    /-/.test(prefix) ||
    /-/.test(suffix) ||
    (prefix.includes("(") && suffix.includes(")"));

  const pre = tokenHint(prefix.replace(/[()+\-\s]/g, ""));
  const suf = tokenHint(suffix.replace(/[()+\-\s]/g, ""));
  if (!pre.ok || !suf.ok) return null;

  const value = resolveNumber(core);
  if (value === null) return null;
  return { value, negative, currency: pre.hint ?? suf.hint };
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

function resolveNumber(coreIn: string): number | null {
  let c = coreIn.trim();
  if (/\s/.test(c)) {
    if (!/^\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(c)) return null;
    c = c.replace(/ /g, "");
  }
  c = c.replace(/['’]/g, "");
  if (!/^[\d.,]+$/.test(c)) return null;

  const dots = count(c, ".");
  const commas = count(c, ",");
  if (dots && commas) {
    const dec = c.lastIndexOf(".") > c.lastIndexOf(",") ? "." : ",";
    const grp = dec === "." ? "," : ".";
    if (count(c, dec) !== 1) return null;
    if (c.lastIndexOf(grp) > c.lastIndexOf(dec)) return null;
    c = c.split(grp).join("").replace(dec, ".");
  } else if (dots || commas) {
    const sep = dots ? "." : ",";
    const parts = c.split(sep);
    if (parts.length > 2) {
      // 1,234,567 or 1.234.567: grouping only.
      if (!parts.slice(1).every((p) => p.length === 3)) return null;
      c = parts.join("");
    } else {
      const [a, b] = parts;
      if (b.length === 3 && /^[1-9]\d{0,2}$/.test(a)) c = a + b; // 1,234 or 1.234
      else c = `${a}.${b}`;
    }
  }
  const n = Number(c);
  if (!Number.isFinite(n) || n > 1e12) return null;
  return Math.round(n * 100) / 100;
}

/* ───────────────────────────── Text helpers ─────────────────────────── */

type Delim = "|" | "\t" | ";" | "," | "  ";

const FENCE_RE = /^\s*(?:```|~~~)/;
const SEPARATOR_RE = /^[\s|:+\-=_*]+$/;
const META_LINE = /^[\s#>|*\-•]*(title|period|currency)\s*[:=]\s*(.*)$/i;
const META_LINE_CELLS = /^#\s*(title|period|currency)\s*[\t;|,]\s*(.*)$/i;
const META_CELL = /^[#\s]*(title|period|currency)\b\s*[:=]?\s*(.*)$/i;

function cleanText(input: string): string {
  return input
    .replace(/^﻿/, "")
    .replace(/[​‌‍⁠﻿]/g, "")
    .replace(/[   -   　]/g, " ")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‛]/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function cleanCell(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, "")
    .replace(/`/g, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLine(line: string, delim: Delim): string[] {
  if (delim === "  ") return line.trim().split(/\s{2,}|\t/);
  let s = line;
  if (delim === "|") {
    s = s.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
  }
  const fields: string[] = [];
  const n = s.length;
  let i = 0;
  for (;;) {
    let j = i;
    while (j < n && s[j] === " ") j++;
    let val = "";
    if (s[j] === '"') {
      j++;
      while (j < n) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            val += '"';
            j += 2;
            continue;
          }
          j++;
          break;
        }
        val += s[j];
        j++;
      }
      while (j < n && s[j] !== delim) {
        val += s[j];
        j++;
      }
    } else {
      while (j < n && s[j] !== delim) {
        val += s[j];
        j++;
      }
    }
    fields.push(val.trim());
    if (j >= n) break;
    i = j + 1;
  }
  return fields;
}

function detectDelimiter(lines: string[]): Delim | null {
  const order: Delim[] = ["|", "\t", ";", ",", "  "];
  let best: Delim | null = null;
  let bestScore = 0;
  for (const d of order) {
    const groups = new Map<number, number>();
    for (const l of lines) {
      const n = splitLine(l, d).length;
      if (n >= 3) groups.set(n, (groups.get(n) ?? 0) + 1);
    }
    let score = 0;
    for (const v of groups.values()) score = Math.max(score, v);
    if (d === "  " && score < 2) score = 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Joins "6", "200.00" back into "6,200.00" when an unquoted amount was split on its comma. */
function mergeSplitAmount(cells: string[]): string[] {
  const n = cells.length;
  if (n < 4 || !/^\d{3}(?:\.\d+)?$/.test(cells[n - 1])) return cells;
  let acc = cells[n - 1];
  let j = n - 2;
  while (j >= 2 && /^\D{0,3}\d{1,3}$/.test(cells[j])) {
    const piece = cells[j];
    acc = `${piece},${acc}`;
    j--;
    const middle = /^\d{3}$/.test(piece);
    if (!(middle && j >= 2 && /^\D{0,3}\d{1,3}$/.test(cells[j]))) break;
  }
  if (acc === cells[n - 1]) return cells;
  return [...cells.slice(0, j + 1), acc];
}

/* ───────────────────────────── Types & headers ──────────────────────── */

const INCOME_STEMS = ["incom", "revenu", "earning", "inflow", "wage", "paycheck"];
const EXPENSE_STEMS = ["expens", "spend", "spent", "outflow", "expenditure", "cost", "bill", "debit", "outgo"];
const SAVINGS_STEMS = ["saving", "saved", "save", "invest", "contribut"];

function normalizeType(cell: string | undefined): FlowType | null {
  if (!cell) return null;
  const words = cell
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  const found = new Set<FlowType>();
  for (const w of words) {
    if (w === "in") found.add("income");
    else if (w === "out") found.add("expense");
    if (INCOME_STEMS.some((s) => w.startsWith(s))) found.add("income");
    if (EXPENSE_STEMS.some((s) => w.startsWith(s))) found.add("expense");
    if (SAVINGS_STEMS.some((s) => w.startsWith(s))) found.add("savings");
  }
  if (found.size !== 1) return null;
  return [...found][0];
}

type Role = "type" | "category" | "subcategory" | "amount" | "weak";

const TYPE_HEADERS = new Set([
  "type", "types", "kind", "flow", "flow type", "transaction type", "txn type",
  "entry type", "direction", "class", "section", "income expense",
  "income or expense", "income expense savings",
]);
const AMOUNT_HEADERS = new Set([
  "amount", "amounts", "total", "totals", "value", "values", "sum", "amt",
  "cost", "spent", "price", "total amount", "monthly total", "period total",
]);
const SUB_HEADERS = new Set([
  "subcategory", "sub category", "subcategories", "sub categories", "subcat",
  "sub cat", "subgroup", "sub group", "sub type", "subtype", "sub item",
  "subitem", "detail", "details",
]);
const CATEGORY_HEADERS = new Set([
  "category", "categories", "cat", "parent", "parent category", "main category",
  "top category", "category name", "bucket",
]);
const WEAK_HEADERS = new Set([
  "group", "name", "item", "label", "description", "source", "line item",
]);

function normalizeHeader(cell: string): string {
  return cell
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roleOf(cell: string): Role | null {
  const h = normalizeHeader(cell);
  if (!h) return null;
  if (TYPE_HEADERS.has(h)) return "type";
  if (SUB_HEADERS.has(h) || /^sub ?(cat|group|type|item)/.test(h)) return "subcategory";
  if (CATEGORY_HEADERS.has(h) || /categ/.test(h)) return "category";
  if (AMOUNT_HEADERS.has(h) || /\b(amount|total)\b/.test(h)) return "amount";
  if (WEAK_HEADERS.has(h)) return "weak";
  return null;
}

/** Currency code hidden in an amount header, e.g. "Amount (EUR)" or "amount_eur". */
function headerCurrency(cell: string): string | undefined {
  const m = /\(([A-Za-z]{3})\)|[\s_]([A-Za-z]{3})$/.exec(cell.trim());
  const code = (m?.[1] ?? m?.[2])?.toUpperCase();
  return code && isCurrencyCode(code) ? code : undefined;
}

/* ───────────────────────────── Issue reporter ───────────────────────── */

class Reporter {
  issues: ParseIssue[] = [];
  private counts = new Map<string, number>();
  constructor(private readonly cap = 15) {}

  warn(kind: string, message: string, line?: number): void {
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    if (n <= this.cap) this.issues.push({ level: "warning", line, message });
  }

  /** Always shown. */
  note(message: string, line?: number): void {
    this.issues.push({ level: "warning", line, message });
  }

  finish(): ParseIssue[] {
    for (const [kind, n] of this.counts) {
      if (n > this.cap) {
        const more = n - this.cap;
        this.issues.push({
          level: "warning",
          message: `${more} more ${more === 1 ? "line has" : "lines have"} the same kind of problem (${kind}) and ${more === 1 ? "was" : "were"} not listed. Fix the ones above and paste again to see the rest.`,
        });
      }
    }
    return this.issues;
  }
}

/* ─────────────────────────────── Main ───────────────────────────────── */

interface Cand {
  no: number;
  text: string;
}
interface Row {
  no: number;
  cells: string[];
}
interface Layout {
  typeIdx: number;
  catIdx: number;
  subIdx: number;
  amountIdx: number;
  /** Number of columns in the header row; 0 when there is no header. */
  headerLen: number;
}
interface Entry {
  type: FlowType;
  category: string;
  sub?: string;
  cents: number;
  line: number;
}

const EXAMPLE = "income,Salary,,6200.00";

function fail(message: string, line?: number): ParseResult {
  return { data: null, issues: [{ level: "error", line, message }] };
}

export function parseFlumeInput(text: string): ParseResult {
  try {
    return run(text);
  } catch {
    return fail(
      "Something went wrong while reading that. Try pasting just the CSV part of your agent's reply, starting at the line that begins with type,category,subcategory,amount.",
    );
  }
}

function describe(category: string, sub?: string): string {
  return sub ? `${category} > ${sub}` : category;
}

function shown(s: string): string {
  const t = s.length > 30 ? `${s.slice(0, 28)}…` : s;
  return t;
}

function run(input: string): ParseResult {
  if (typeof input !== "string" || input.trim() === "") {
    return fail("There is nothing to read yet. Paste the reply from your AI agent, or drop in a .csv file.");
  }
  const rep = new Reporter();
  const rawLines = cleanText(input).split(/\r\n|\r|\n/);

  /* 1. Pull out metadata, drop fences, comments and table borders. */
  const meta: { title?: string; period?: string; currency?: string } = {};
  const setMeta = (key: string, value: string) => {
    const v = value.replace(/[\s,;|\t]+$/, "").replace(/^["']+|["']+$/g, "").trim();
    if (!v) return;
    const k = key.toLowerCase() as "title" | "period" | "currency";
    if (meta[k] === undefined) meta[k] = v;
  };

  const cands: Cand[] = [];
  rawLines.forEach((raw, idx) => {
    let t = raw.trim();
    if (!t) return;
    if (FENCE_RE.test(t)) return;
    const mm = META_LINE.exec(t.replace(/\*\*|__|`/g, ""));
    if (mm) {
      setMeta(mm[1], mm[2]);
      return;
    }
    const mc = META_LINE_CELLS.exec(t);
    if (mc) {
      setMeta(mc[1], mc[2]);
      return;
    }
    if (/^(#|\/\/)/.test(t)) return;
    t = t.replace(/^>\s?/, "").replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "");
    if (!t || SEPARATOR_RE.test(t)) return;
    cands.push({ no: idx + 1, text: t });
  });

  const noTable = () =>
    fail(
      `We couldn't find any rows of data in that text. Flume needs one line per category: type, category, subcategory, amount. For example: ${EXAMPLE} or expense,Housing,Rent,2100.00. Ask your agent to reply with only the CSV, then copy the whole code block.`,
    );

  if (cands.length === 0) return noTable();
  const delim = detectDelimiter(cands.map((c) => c.text));
  if (!delim) return noTable();

  /* 2. Split into cells. */
  const rows: Row[] = [];
  for (const c of cands) {
    let cells = splitLine(c.text, delim).map(cleanCell);
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length === 0) continue;
    if (cells.every((x) => /^:?-{2,}:?$/.test(x) || x === "")) continue;
    const nonEmpty = cells.filter((x) => x !== "");
    if (nonEmpty.length <= 2) {
      const mc = META_CELL.exec(cells[0]);
      if (mc && roleOf(cells[0]) === null) {
        setMeta(mc[1], mc[2] || cells.slice(1).find((x) => x !== "") || "");
        continue;
      }
    }
    if (delim === ",") cells = mergeSplitAmount(cells);
    if (cells.length < 2) continue;
    rows.push({ no: c.no, cells });
  }

  /* 3. Header row. */
  const isDataLike = (cells: string[]) =>
    cells.length >= 3 &&
    cells.some((x) => normalizeType(x) !== null) &&
    cells.some((x) => x !== "" && parseAmount(x) !== null);

  const headerRoles = (cells: string[]): Role[] | null => {
    if (cells.some((x) => x !== "" && parseAmount(x) !== null)) return null;
    const roles = cells.map((x) => (x === "" ? null : roleOf(x)));
    const named = roles.filter((r): r is Role => r !== null);
    const distinct = new Set(named);
    const nonEmpty = cells.filter((x) => x !== "").length;
    if (distinct.size < 2 || named.length * 2 < nonEmpty) return null;
    return roles as Role[];
  };

  const firstDataIdx = rows.findIndex((r) => isDataLike(r.cells));
  let headerIdx = -1;
  let headerRolesFound: Role[] | null = null;
  for (let i = 0; i < rows.length && (firstDataIdx < 0 || i < firstDataIdx); i++) {
    const hr = headerRoles(rows[i].cells);
    if (hr) {
      headerIdx = i;
      headerRolesFound = hr;
      break;
    }
  }
  const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;

  /* 4. Which column is which. */
  const widthOf = (rs: Row[]) => rs.reduce((m, r) => Math.max(m, r.cells.length), 0);
  const typeScore = (col: number) =>
    dataRows.filter((r) => normalizeType(r.cells[col]) !== null).length;

  const layout: Layout = { typeIdx: -1, catIdx: -1, subIdx: -1, amountIdx: -1, headerLen: 0 };
  let headerCurrencyHint: string | undefined;

  if (headerRolesFound) {
    const hdr = rows[headerIdx].cells;
    layout.headerLen = hdr.length;
    const roles = headerRolesFound;
    layout.typeIdx = roles.indexOf("type");
    layout.amountIdx = roles.indexOf("amount");
    layout.subIdx = roles.indexOf("subcategory");
    layout.catIdx = roles.indexOf("category");
    const weak = roles.flatMap((r, i) => (r === "weak" ? [i] : []));
    if (layout.catIdx < 0 && weak.length) layout.catIdx = weak.shift() as number;
    if (layout.subIdx < 0 && weak.length) layout.subIdx = weak.shift() as number;
    if (layout.amountIdx >= 0) headerCurrencyHint = headerCurrency(hdr[layout.amountIdx]);
  }

  if (layout.typeIdx < 0) {
    const taken = new Set([layout.catIdx, layout.subIdx, layout.amountIdx]);
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < widthOf(dataRows); c++) {
      if (taken.has(c)) continue;
      const sc = typeScore(c);
      if (sc > bestScore) {
        best = c;
        bestScore = sc;
      }
    }
    layout.typeIdx = best;
  }

  if (layout.typeIdx < 0) {
    const seen = [...new Set(dataRows.slice(0, 6).map((r) => r.cells[0]).filter(Boolean))]
      .slice(0, 3)
      .map((x) => `"${shown(x)}"`);
    const seenText = seen.length ? ` (the first column starts with ${seen.join(", ")})` : "";
    const where = headerRolesFound
      ? `In the header row (line ${rows[headerIdx].no}) there is no "type" column, and none of the rows has income, expense or savings in it${seenText}.`
      : `None of the rows has income, expense or savings in it${seenText}.`;
    const fix = `Flume needs a first column that says what each row is, using one of those three words. For example: ${EXAMPLE}`;
    const err = fail(`${where} ${fix}`);
    err.issues.push(...rep.finish());
    return err;
  }

  /* 5. Walk the rows. */
  const isHeaderLike = (cells: string[]) => headerRoles(cells) !== null;
  const recognized = dataRows.map((r) => normalizeType(r.cells[layout.typeIdx]));
  const firstRec = recognized.findIndex((t) => t !== null);
  let lastRec = -1;
  recognized.forEach((t, i) => {
    if (t !== null) lastRec = i;
  });

  const entries: Entry[] = [];
  const hints: CurrencyHint[] = [];

  dataRows.forEach((row, i) => {
    const cells = row.cells;
    if (isHeaderLike(cells)) return;
    const type = recognized[i];
    if (type === null) {
      if (i > firstRec && i < lastRec && cells.length >= 3 && cells.some((x) => parseAmount(x) !== null)) {
        const what = cells[layout.typeIdx] ?? "";
        rep.warn(
          "unknown type",
          `Line ${row.no}: "${shown(what)}" isn't income, expense or savings, so this row was skipped. Change the first column to one of those three words if you want it in the chart.`,
          row.no,
        );
      }
      return;
    }

    /* Which cell is what. */
    let catCell = "";
    let subCell = "";
    let amountCell = "";
    let extra = false;
    const canDirect =
      layout.headerLen > 0 &&
      layout.catIdx >= 0 &&
      layout.amountIdx >= 0 &&
      cells.length >= layout.headerLen;
    const directAmount = canDirect ? cells[layout.amountIdx] ?? "" : "";
    if (canDirect && (directAmount === "" || parseAmount(directAmount) !== null || cells.length === layout.headerLen)) {
      catCell = cells[layout.catIdx] ?? "";
      subCell = layout.subIdx >= 0 ? cells[layout.subIdx] ?? "" : "";
      amountCell = directAmount;
    } else {
      let amountIdx = -1;
      for (let k = cells.length - 1; k >= 0; k--) {
        if (k === layout.typeIdx) continue;
        if (cells[k] !== "" && parseAmount(cells[k]) !== null) {
          amountIdx = k;
          break;
        }
      }
      if (amountIdx < 0) {
        const last = cells.length - 1;
        const lastCell = last !== layout.typeIdx ? cells[last] ?? "" : "";
        amountCell = /\d/.test(lastCell) ? lastCell : "";
        amountIdx = last;
      } else {
        amountCell = cells[amountIdx];
      }
      let texts = cells.filter((_, k) => k !== layout.typeIdx && k < amountIdx);
      if (texts.every((x) => x === "") && amountIdx < cells.length - 1) {
        texts = cells.filter((_, k) => k !== layout.typeIdx && k > amountIdx);
      }
      catCell = texts[0] ?? "";
      const rest = texts.slice(1).filter((x) => x !== "");
      subCell = rest.join(", ");
      extra = layout.headerLen > 0 && cells.length > layout.headerLen && rest.length > 1;
    }

    /* Names. */
    let category = catCell.trim();
    let sub: string | undefined = subCell.trim();
    if (!sub && /\s(?:>|→|»|›)\s/.test(` ${category} `)) {
      const [a, ...b] = category.split(/\s*(?:>|→|»|›)\s*/);
      category = a.trim();
      sub = b.join(" > ").trim();
    }
    if (PLACEHOLDER_RE.test(sub ?? "")) sub = undefined;
    if (PLACEHOLDER_RE.test(category)) category = "";
    if (!category && sub) {
      category = sub;
      sub = undefined;
    }
    if (sub && sub.toLowerCase() === category.toLowerCase()) sub = undefined;
    const lineDesc = describe(category || "(no name)", sub);

    /* Amount. */
    if (amountCell.trim() === "") {
      rep.warn(
        "missing amount",
        `Line ${row.no} (${lineDesc}): there is no amount, so this row was skipped. Add the total for this line, for example ${EXAMPLE}.`,
        row.no,
      );
      return;
    }
    const amt = parseAmount(amountCell);
    if (!amt) {
      rep.warn(
        "unreadable amount",
        `Line ${row.no} (${lineDesc}): "${shown(amountCell)}" isn't an amount we can read, so this row was skipped. Use a plain number such as 1234.56.`,
        row.no,
      );
      return;
    }
    if (amt.value === 0) {
      rep.warn(
        "zero amount",
        `Line ${row.no} (${lineDesc}): the amount is zero, so this row was skipped.`,
        row.no,
      );
      return;
    }
    if (amt.negative) {
      rep.warn(
        "negative amount",
        `Line ${row.no} (${lineDesc}): the amount "${shown(amountCell)}" is negative, so we used ${amt.value} instead. Amounts should be positive; fold refunds into the category they belong to.`,
        row.no,
      );
    }
    if (!category) {
      category = "Other";
      rep.warn(
        "no category",
        `Line ${row.no}: there is no category name, so we filed this row under "Other". Add a category if you want it labelled.`,
        row.no,
      );
    }
    if (extra) {
      rep.warn(
        "extra columns",
        `Line ${row.no} (${lineDesc}): this row has more columns than the header. If a name contains a comma, put the name in "double quotes". We joined the extra pieces onto the subcategory.`,
        row.no,
      );
    }
    if (amt.currency) hints.push(amt.currency);
    entries.push({
      type,
      category: category.slice(0, 80),
      sub: sub ? sub.slice(0, 80) : undefined,
      cents: Math.round(amt.value * 100),
      line: row.no,
    });
  });

  /* 6. Nothing usable? */
  if (entries.length === 0) {
    if (firstRec < 0) {
      const seen = [
        ...new Set(
          dataRows
            .filter((r) => r.cells.length >= 3)
            .map((r) => r.cells[layout.typeIdx])
            .filter((x): x is string => !!x),
        ),
      ]
        .slice(0, 3)
        .map((x) => `"${shown(x)}"`);
      const err = fail(
        `None of the rows could be read: the first column should say income, expense or savings${seen.length ? `, but we found ${seen.join(", ")}` : ""}. For example: ${EXAMPLE}`,
      );
      err.issues.push(...rep.finish());
      return err;
    }
    const err = fail(
      "We found rows, but every one of them was skipped, so there is nothing to draw. The notes below say what to fix on each line.",
    );
    err.issues.push(...rep.finish());
    return err;
  }

  /* 7. Merge duplicates. */
  const merged = new Map<string, Entry>();
  for (const e of entries) {
    const key = `${e.type}|${e.category.toLowerCase()}|${(e.sub ?? "").toLowerCase()}`;
    const prev = merged.get(key);
    if (prev) {
      prev.cents += e.cents;
      rep.warn(
        "repeated row",
        `Line ${e.line} (${describe(e.category, e.sub)}) repeats line ${prev.line}, so we added the two amounts together. Delete one of them if that was a mistake.`,
        e.line,
      );
    } else {
      merged.set(key, { ...e });
    }
  }
  const outRows: FlowRow[] = [...merged.values()].map((e) => ({
    type: e.type,
    category: e.category,
    ...(e.sub ? { subcategory: e.sub } : {}),
    amount: e.cents / 100,
  }));

  /* 8. Currency. */
  let currency = "USD";
  const declared = meta.currency ? parseCurrencyDeclaration(meta.currency) : undefined;
  if (meta.currency && !declared) {
    rep.note(
      `The currency line says "${shown(meta.currency)}", which we don't recognise. Use a three-letter code such as USD, EUR or GBP. We worked it out from the amounts instead.`,
    );
  }
  const counts = new Map<string, { n: number; hint: CurrencyHint }>();
  for (const h of hints) {
    const c = counts.get(h.code);
    if (c) c.n++;
    else counts.set(h.code, { n: 1, hint: h });
  }
  const inferred = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.hint;
  if (declared) {
    currency = declared;
    const clash = [...counts.values()].find(
      (c) => c.hint.code !== declared && !(c.hint.family ?? []).includes(declared),
    );
    if (clash) {
      rep.note(
        `The currency line says ${declared}, but some amounts use ${clash.hint.code}. Flume does not convert between currencies, so every amount is shown as ${declared}. Ask your agent to give everything in one currency.`,
      );
    }
  } else {
    currency = inferred?.code ?? headerCurrencyHint ?? "USD";
    if (counts.size > 1) {
      rep.note(
        `The amounts use more than one currency (${[...counts.keys()].join(", ")}). Flume does not convert between them, so everything is shown as ${currency}. Ask your agent to give all amounts in one currency.`,
      );
    }
  }

  /* 9. One-sided data. */
  const has = (t: FlowType) => outRows.some((r) => r.type === t);
  if (!has("income")) {
    rep.note(
      "There are no income rows, so the chart will show your spending as paid from savings. If you expected income, check that those lines start with the word income.",
    );
  } else if (!has("expense") && !has("savings")) {
    rep.note(
      "There are no expense or savings rows, so the chart will show all of your income as left over. If you expected spending, check that those lines start with expense or savings.",
    );
  }

  const data: FlumeData = { currency, rows: outRows };
  const title = meta.title ?? meta.period;
  if (title) data.title = title.slice(0, 100);

  const issues = rep.finish();
  issues.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
  return { data, issues };
}

/** Subcategory or category text that means "nothing". */
const PLACEHOLDER_RE =
  /^(?:[\s\-–—_./?*]*|n\/?a|n\.a\.?|none|null|nil|nan|undefined|\(?(?:none|blank|empty|n\/a)\)?|no subcategory|uncategori[sz]ed subcategory)$/i;
