#!/usr/bin/env node
// Screenshot helper for visual checks. Each run launches its own headless
// browser, so several people/agents can use it at once without colliding.
//
//   node scripts/shot.mjs <url> <out.png> [options]
//
//   --w <px>        viewport width   (default 1440)
//   --h <px>        viewport height  (default 900)
//   --mobile        390x844 @3x, touch, mobile UA
//   --dark          force dark theme (sets localStorage flume-theme)
//   --light         force light theme
//   --full          capture the full scrollable page
//   --wait <ms>     extra wait after load (default 1200; raise it to let
//                   entrance animations finish, or lower it to catch them)
//   --reduced       emulate prefers-reduced-motion: reduce
//   --selector <s>  capture only the first element matching the selector
//   --eval <js>     run JS in the page before the screenshot (after --wait)

import { chromium, devices } from "playwright";

const args = process.argv.slice(2);
const [url, out] = args;
if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [options]");
  process.exit(1);
}
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const mobile = flag("mobile");
const theme = flag("dark") ? "dark" : flag("light") ? "light" : null;

const browser = await chromium.launch();
const context = await browser.newContext(
  mobile
    ? { ...devices["iPhone 14"] }
    : {
        viewport: { width: Number(opt("w", 1440)), height: Number(opt("h", 900)) },
        deviceScaleFactor: 2,
      },
);
if (flag("reduced")) await context.addInitScript(() => {});
const page = await context.newPage();
if (flag("reduced")) await page.emulateMedia({ reducedMotion: "reduce" });
if (theme) {
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("flume-theme", t);
    } catch {}
  }, theme);
  await page.emulateMedia({
    colorScheme: theme,
    reducedMotion: flag("reduced") ? "reduce" : "no-preference",
  });
}

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(Number(opt("wait", 1200)));
const js = opt("eval", null);
if (js) {
  await page.evaluate(js);
  await page.waitForTimeout(300);
}

const selector = opt("selector", null);
if (selector) {
  await page.locator(selector).first().screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage: flag("full") });
}
await browser.close();

if (errors.length) {
  console.log(`saved ${out} — with ${errors.length} page error(s):`);
  for (const e of errors) console.log("  " + e);
} else {
  console.log(`saved ${out} — no page errors`);
}
