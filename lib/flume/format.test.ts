import { describe, expect, it } from "vitest";
import { formatMoney, formatPercent } from "./format";

describe("formatMoney", () => {
  it("drops decimals at 100 and above", () => {
    expect(formatMoney(2150, "USD")).toBe("$2,150");
    expect(formatMoney(100, "USD")).toBe("$100");
    expect(formatMoney(2150.49, "USD")).toBe("$2,150");
    expect(formatMoney(2150.5, "USD")).toBe("$2,151");
    expect(formatMoney(1234567, "USD")).toBe("$1,234,567");
  });

  it("is sensible for small values", () => {
    expect(formatMoney(62.4, "USD")).toBe("$62.40");
    expect(formatMoney(45, "USD")).toBe("$45");
    expect(formatMoney(0.5, "USD")).toBe("$0.50");
    expect(formatMoney(0, "USD")).toBe("$0");
    expect(formatMoney(99.99, "USD")).toBe("$99.99");
  });

  it("shows cents on request", () => {
    expect(formatMoney(2150, "USD", { decimals: true })).toBe("$2,150.00");
    expect(formatMoney(62.4, "USD", { decimals: true })).toBe("$62.40");
  });

  it("formats other currencies", () => {
    expect(formatMoney(2150, "EUR")).toBe("€2,150");
    expect(formatMoney(2150, "GBP")).toBe("£2,150");
    expect(formatMoney(2150, "JPY")).toBe("¥2,150");
    expect(formatMoney(2150, "eur")).toBe("€2,150");
  });

  it("compacts for tight spaces", () => {
    expect(formatMoney(2150, "USD", { compact: true })).toBe("$2.2k");
    expect(formatMoney(2000, "USD", { compact: true })).toBe("$2k");
    expect(formatMoney(1_300_000, "USD", { compact: true })).toBe("$1.3M");
    expect(formatMoney(850, "USD", { compact: true })).toBe("$850");
    expect(formatMoney(62.4, "USD", { compact: true })).toBe("$62.40");
    expect(formatMoney(45_000, "USD", { compact: true })).toBe("$45k");
    expect(formatMoney(2_500_000_000, "USD", { compact: true })).toBe("$2.5B");
    expect(formatMoney(2150, "EUR", { compact: true })).toBe("€2.2k");
  });

  it("rolls over at compact boundaries instead of printing 1000k", () => {
    expect(formatMoney(999_960, "USD", { compact: true })).toBe("$1M");
    expect(formatMoney(999_940, "USD", { compact: true })).toBe("$999.9k");
  });

  it("handles negatives", () => {
    expect(formatMoney(-2150, "USD")).toBe("-$2,150");
    expect(formatMoney(-2150, "USD", { compact: true })).toBe("-$2.2k");
  });

  it("falls back gracefully for invalid currency codes", () => {
    expect(formatMoney(2150, "XX")).toBe("XX 2,150");
    expect(formatMoney(2150, "")).toBe("2,150");
    expect(formatMoney(2150, "not a code")).toBe("not a code 2,150");
    expect(formatMoney(2150, "US$")).toBe("US$ 2,150");
    expect(formatMoney(2150, "ZZZ", { compact: true })).toMatch(/2\.2k$/);
  });

  it("never throws on odd numbers", () => {
    expect(formatMoney(NaN, "USD")).toBe("$0");
    expect(formatMoney(Infinity, "USD")).toBe("$0");
    expect(formatMoney(2150, undefined as unknown as string)).toBe("2,150");
  });
});

describe("formatPercent", () => {
  it("formats ordinary shares", () => {
    expect(formatPercent(12, 100)).toBe("12%");
    expect(formatPercent(1, 3)).toBe("33%");
    expect(formatPercent(1, 1)).toBe("100%");
    expect(formatPercent(1.5, 1)).toBe("150%");
    expect(formatPercent(1, 100)).toBe("1%");
  });

  it("shows one decimal below 1%", () => {
    expect(formatPercent(0.4, 100)).toBe("0.4%");
    expect(formatPercent(5, 1000)).toBe("0.5%");
    expect(formatPercent(0.96, 100)).toBe("1%");
  });

  it("shows <0.1% for tiny shares", () => {
    expect(formatPercent(1, 5000)).toBe("<0.1%");
    expect(formatPercent(0.04, 100)).toBe("<0.1%");
  });

  it("is safe when the whole is zero, negative or not a number", () => {
    expect(formatPercent(5, 0)).toBe("0%");
    expect(formatPercent(0, 0)).toBe("0%");
    expect(formatPercent(5, -3)).toBe("0%");
    expect(formatPercent(NaN, 10)).toBe("0%");
    expect(formatPercent(5, Infinity)).toBe("0%");
  });

  it("shows 0% for a zero part", () => {
    expect(formatPercent(0, 100)).toBe("0%");
  });
});
