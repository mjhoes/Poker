const { chromium } = require('playwright');
const fs = require('fs');
// Usage (from apps/web): node scripts/render-icons.cjs assets-src public, then compress the PNGs if wanted.
const dir = process.argv[2] ?? "assets-src", out = process.argv[3] ?? "public";
(async () => {
  const browser = await chromium.launch();
  const jobs = [["icon.svg", 192, "icon-192.png", true], ["icon.svg", 512, "icon-512.png", true],
    ["icon-maskable.svg", 512, "icon-maskable-512.png", false], ["icon-maskable.svg", 180, "apple-touch-icon.png", false]];
  for (const [src, size, name, transparent] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const svg = fs.readFileSync(`${dir}/${src}`, "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: `${out}/${name}`, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  await browser.close();
})();
