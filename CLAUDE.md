@AGENTS.md

# Flume

A website that turns a person's income and spending into an animated Sankey
chart and exports it as a PNG. There is no backend and no account linking: the
user copies a prompt into their own AI agent (which already has their bank
data), the agent replies with a small CSV, and the user pastes or drops that
CSV here. Everything runs in the browser; nothing is uploaded.

## Stack

Next.js 16 App Router, React 19, TypeScript, Tailwind v4, `d3-sankey` for
layout, `motion` for UI animation, Vitest for unit tests. Next 16 differs from
older versions: check `node_modules/next/dist/docs/` before using an API you
are not sure about.

## Layout of the code

- `lib/flume/types.ts` — the data contract every module shares. Read it first.
- `lib/flume/prompt.ts` — the prompt users give their agent; defines the CSV format.
- `lib/flume/sample.ts` — `SAMPLE_CSV`, demo data in that format.
- `lib/flume/parse.ts` — `parseFlumeInput(text): ParseResult` (tolerant CSV/paste parser).
- `lib/flume/graph.ts` — `buildGraph(data, { detail }): FlumeGraph`.
- `lib/flume/format.ts` — money and percent formatting.
- `lib/flume/palette.ts` — flow colors per theme.
- `lib/flume/layout.ts` — `computeLayout(graph, opts)`: pure geometry shared by the on-screen chart and the PNG export.
- `lib/flume/export.ts` — `exportPng(graph, opts): Promise<Blob>`, drawn on a canvas.
- `lib/flume/theme.ts` — UI tokens as resolved hex values (mirror of `app/globals.css`).
- `lib/use-theme.ts` — `useTheme()`; theme lives on `<html data-theme>`.
- `lib/brand.ts`, `components/brand/` — the Flume logo as React components and as a canvas drawing helper.
- `components/sankey/` — the animated SVG chart.
- `app/dev/*` — scratch routes for developing a piece in isolation.

## Conventions

- Colors come from the tokens in `app/globals.css` (Tailwind classes such as
  `bg-surface`, `text-text-muted`, `border-border`, `bg-accent`). Both light
  and dark themes must look right; dark is `[data-theme="dark"]` on `<html>`.
- Anything drawn on a canvas or inside SVG gradients takes resolved colors
  from `lib/flume/theme.ts` and `lib/flume/palette.ts`, not CSS variables.
- Amounts use tabular numerals (`tabular-nums`).
- Respect `prefers-reduced-motion`.
- Must work from 360px wide phones up to large desktops, and by touch.

## Commands

- `npm run dev` — dev server (usually already running on http://localhost:3000).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest.
- `npm run lint` — ESLint.
- `node scripts/shot.mjs <url> <out.png> [--mobile] [--dark] [--full] [--wait ms]`
  — take a screenshot with a private headless browser, then open the PNG to
  look at it. See the header of the script for all options.
