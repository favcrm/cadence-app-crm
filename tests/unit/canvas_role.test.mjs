// CRM-27: in the canvas role the screen hides its own list heading (the canvas
// header names the view) and pads by role, not by viewport width.
// Run: bun test tests/unit/canvas_role.test.mjs
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../src/features/crm/${p}`, import.meta.url), "utf8");
const css = read("crm-layout.css");

test.each([
  ["customers/Customers.tsx", "Customers"],
  ["segments/Segments.tsx", "Segments"],
  ["campaigns/CampaignList.tsx", "Campaigns"],
])("%s renders its list heading only outside the canvas", (file, title) => {
  expect(read(file)).toMatch(new RegExp(`\\{!viewer\\.canvas && \\(\\s*<h3[^>]*data-outlet-heading>\\s*\\{t\\("${title}"\\)\\}`));
});

test("the outlet carries the crm-canvas class in the canvas role only", () => {
  expect(read("CrmScreen.tsx")).toContain('className={canvas ? "app-outlet crm crm-canvas" : "app-outlet crm"}');
});

test("the canvas class pads 16-24px at every width and wins over the media queries", () => {
  const base = css.match(/main\.crm\.crm-canvas \{\s*padding-inline: ([\d.]+)rem;/);
  expect(base).not.toBeNull();
  expect(Number(base[1]) * 16).toBeGreaterThanOrEqual(16);
  expect(Number(base[1]) * 16).toBeLessThanOrEqual(24);
  expect(css).toMatch(/@media \(max-width: 36rem\) \{\s*main\.crm\.crm-canvas \{\s*padding-inline: 1rem;/);
  expect(css.indexOf("main.crm.crm-canvas")).toBeGreaterThan(css.indexOf("@media (max-width: 36rem) {\n  main.crm {"));
  // The full page stays unpadded at 1100px and up.
  expect(css).not.toMatch(/min-width: 68\.75rem[^}]*main\.crm/);
});
