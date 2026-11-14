/**
 * Measures the sport-card row on the home screen.
 *
 * The home screen's four sport cards are one band of glass hanging over the
 * photograph. That only reads as tidy if they share a top edge, a height and a
 * width, and if the gutters between them are even. This script proves it by
 * reading the real geometry out of a rendered page, so a layout regression
 * fails loudly instead of being noticed by eye.
 *
 * Usage:
 *   node scripts/check-card-layout.mjs [url] [outPng] [width] [height]
 *
 * Defaults: http://localhost:4174/  home-cards-desktop.png  1440  900
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4174/";
const out = process.argv[3] ?? "home-cards-desktop.png";
const width = Number(process.argv[4] ?? 1440);
const height = Number(process.argv[5] ?? 900);

/**
 * Playwright wants one exact browser build. The build it wants is often not
 * the build that is installed, so find one that is actually on this machine
 * rather than hard-coding a path that only works on one laptop.
 */
function findInstalledChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : undefined,
    join(homedir(), "AppData", "Local", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).sort().reverse()) {
      const lower = dir.toLowerCase();
      if (!lower.startsWith("chromium")) continue;
      const base = join(root, dir);
      for (const rel of [
        join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
        join("chrome-headless-shell-linux64", "chrome-headless-shell"),
        join("chrome-win64", "chrome.exe"),
        join("chrome-win", "chrome.exe"),
        join("chrome-linux", "chrome"),
      ]) {
        const exe = join(base, rel);
        if (existsSync(exe)) return exe;
      }
    }
  }

  for (const fallback of [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ]) {
    if (existsSync(fallback)) return fallback;
  }

  return undefined;
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    const exe = findInstalledChromium();
    if (!exe) {
      throw new Error(
        "No Chromium available for Playwright. Run: npx playwright install chromium",
      );
    }
    console.error(`Using installed browser: ${exe}`);
    return await chromium.launch({ executablePath: exe });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const cards = await page.$$eval("a.rounded-3", (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      href: el.getAttribute("href"),
      label: el.innerText.split("\n").filter(Boolean).slice(1, 2)[0] ?? "",
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      transform: cs.transform,
      zIndex: cs.zIndex,
    };
  }),
);

console.log(JSON.stringify(cards, null, 2));

// The row is tidy when the cards share a top edge, a height and a width, and
// the space between them is even. Their left edges are SUPPOSED to differ —
// that is the grid.
const sameTop = new Set(cards.map((c) => c.y)).size === 1;
const sameHeight = new Set(cards.map((c) => c.h)).size === 1;
const sameWidth = new Set(cards.map((c) => c.w)).size === 1;
const noOffsets = cards.every((c) => c.transform === "none");

const sorted = [...cards].sort((a, b) => a.x - b.x);
const gutters = sorted.slice(1).map((c, i) => c.x - (sorted[i].x + sorted[i].w));
const evenGutters = gutters.length > 0 && new Set(gutters).size === 1;

console.log("shared top edge:", sameTop, "—", [...new Set(cards.map((c) => c.y))]);
console.log("shared height:", sameHeight, "—", [...new Set(cards.map((c) => c.h))]);
console.log("shared width:", sameWidth, "—", [...new Set(cards.map((c) => c.w))]);
console.log("gutters:", gutters, "even:", evenGutters);
console.log("no positional offsets:", noOffsets);

const aligned =
  cards.length === 4 && sameTop && sameHeight && sameWidth && evenGutters && noOffsets;
console.log("aligned row:", aligned);

await page.screenshot({ path: out });
await browser.close();

process.exit(aligned ? 0 : 1);
