import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The Draw / Check answer button (`.btn.draw`) puts 14px bold text on a gradient: every color the label can sit on
 * must give it at least 4.5:1 contrast (WCAG AA for normal-size text, docs/02-PRODUCT-SPEC.md), in its resting and
 * hover states alike.
 */
const css = fileURLToPath(new URL("../src/styles/components.css", import.meta.url));
const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe("the Draw button's colors", () => {
  it("keep its label at 4.5:1 or more on every gradient color, resting and hovered", async () => {
    const text = await readFile(css, "utf8");
    for (const selector of [".btn.draw {", ".btn.draw:hover:not(:disabled) {"]) {
      const rule = text.slice(text.indexOf(selector), text.indexOf("}", text.indexOf(selector)));
      const label = rule.match(/[;{]\s*color:\s*(#[0-9a-f]{6}|#fff)\b/i)![1].replace(/^#fff$/i, "#ffffff");
      const stops = rule.match(/linear-gradient\(([^)]*)\)/)![1].match(/#[0-9a-f]{6}/gi)!;
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const stop of stops) expect(contrast(label, stop), `${selector} ${label} on ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
