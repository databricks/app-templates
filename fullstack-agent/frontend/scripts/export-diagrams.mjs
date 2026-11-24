/**
 * Exports each diagram in docs/images to a PNG next to its HTML source.
 *
 * Run from the repo root after changing a diagram:
 *   node frontend/scripts/export-diagrams.mjs [name ...]
 * Without names it exports every docs/images/*.html. It screenshots the
 * #diagram element at twice the CSS size, after DM Sans has loaded, so the
 * export needs network access to Google Fonts.
 */
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const imagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/images");
const requested = process.argv.slice(2);
const names = requested.length > 0
  ? requested
  : readdirSync(imagesDir).filter((file) => file.endsWith(".html")).map((file) => file.slice(0, -5));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const name of names) {
  await page.goto(`file://${join(imagesDir, `${name}.html`)}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#diagram").screenshot({ path: join(imagesDir, `${name}.png`) });
  console.log(`docs/images/${name}.png`);
}
await browser.close();
