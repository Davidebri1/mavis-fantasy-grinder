/**
 * mavis-render-categorical-shots.cjs
 *
 * Renders the two categorical evaluation SVGs to PNG at their exact canvas
 * size, so nothing is clipped and no white margin is added.
 *
 * The SVG is inlined into a page rather than opened as a document: a
 * fullPage screenshot of a raw SVG never settles and times out.
 */

const { existsSync, readdirSync, readFileSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");
const { chromium } = require("playwright");

function findChromium() {
  const root = join(homedir(), "AppData", "Local", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.toLowerCase().startsWith("chromium")) continue;
    for (const rel of [
      join(dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      join(dir, "chrome-win64", "chrome.exe"),
      join(dir, "chrome-win", "chrome.exe"),
    ]) {
      const exe = join(root, rel);
      if (existsSync(exe)) return exe;
    }
  }
}

const DIR = "C:/Users/D/mavis-outlier/docs/shots";
const SHOTS = ["mavis-categorical-histograms", "mavis-categorical-hit-rates"];

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium() });
  for (const name of SHOTS) {
    const svgPath = join(DIR, name + ".svg");
    const svg = readFileSync(svgPath, "utf8");
    const w = Number(/width="([0-9]+)"/.exec(svg)[1]);
    const h = Number(/height="([0-9]+)"/.exec(svg)[1]);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.setContent(
      "<!doctype html><html><head><meta charset=\"utf-8\"><style>html,body{margin:0;padding:0;background:#ffffff;overflow:hidden}svg{display:block}</style></head><body>" +
      svg +
      "</body></html>",
      { waitUntil: "load" }
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(DIR, name + ".png") });
    await page.close();
    console.log("rendered " + name + ".png at " + w + "x" + h);
  }
  await browser.close();
})().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
