// Renders each ```mermaid block of a Markdown file to PNG with Playwright's Chromium.
// Usage: node render_mermaid.mjs INFORME.md OUT_DIR
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(process.env.PLAYWRIGHT_FROM + "/");
const { chromium } = require("playwright");

const [source, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const blocks = [...readFileSync(source, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1100, height: 800 } });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
<div id="c"></div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
</body></html>`);
await page.waitForFunction(() => window.mermaid);
await page.evaluate(() => mermaid.initialize({ startOnLoad: false, theme: "neutral", fontFamily: "Arial", flowchart: { htmlLabels: false } }));
const sizes = [];
for (const [index, code] of blocks.entries()) {
  const svg = await page.evaluate(async ({ code, index }) => (await mermaid.render(`d${index}`, code)).svg, { code, index });
  await page.evaluate((svg) => {
    document.getElementById("c").innerHTML = `<div id="w" style="display:inline-block;padding:12px;background:#fff">${svg}</div>`;
    const el = document.querySelector("#w svg");
    const vb = el.viewBox.baseVal;
    el.style.maxWidth = "none";
    el.setAttribute("width", vb.width);
    el.setAttribute("height", vb.height);
  }, svg);
  const element = await page.$("#w");
  const box = await element.boundingBox();
  await element.screenshot({ path: `${outDir}/figura-${index + 1}.png` });
  sizes.push({ file: `figura-${index + 1}.png`, width: Math.round(box.width), height: Math.round(box.height) });
}
writeFileSync(`${outDir}/sizes.json`, JSON.stringify(sizes));
await browser.close();
console.log(`${blocks.length} diagramas`);
