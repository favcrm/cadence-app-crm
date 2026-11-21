// CRM-21: canvas padding below the full-page width, and tag chips that keep words whole.
// Run: bun test tests/unit/canvas_padding.test.mjs
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/features/crm/crm-layout.css", import.meta.url), "utf8");

test("the outer outlet is padded below 1100px and not at full page width", () => {
  expect(css).toMatch(/@media \(max-width: 68\.74rem\) \{\s*main\.crm \{\s*padding-inline: 1rem;\s*padding-block: 0\.75rem;/);
  expect(css).toMatch(/@media \(max-width: 36rem\) \{\s*main\.crm \{\s*padding-inline: 0\.75rem;/);
  expect(css).not.toMatch(/min-width: 68\.75rem[^}]*main\.crm/);
});

test("chips never break inside a word", () => {
  const chip = css.match(/\.crm \.chip \{[^}]*\}/)[0];
  expect(chip).not.toContain("anywhere");
  expect(chip).toContain("overflow-wrap: normal");
  expect(css).toMatch(/\.crm button\.chip \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/);
});
