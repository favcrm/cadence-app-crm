// CRM-22: every read-only wording the CRM screen can show has zh-TW and zh-HK text.
// Run: bun test tests/unit/readonly_locale.test.mjs
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { zhHK, zhTW } from "../../src/features/crm/localeCatalog.ts";

const root = new URL("../../src/features/crm/", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && name !== "localeCatalog.ts") files.push(p);
  }
})(root);
const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
const readOnly = [...new Set([...source.matchAll(/"(Read-only view\.[^"]*)"/g)].map((m) => m[1]))];

test("the source still has the read-only strings this test guards", () => {
  expect(readOnly.length).toBeGreaterThanOrEqual(9);
});

test("no read-only string is built by interpolation", () => {
  expect(source).not.toMatch(/`Read-only view\./);
});

for (const [name, catalog] of [["zh-TW", zhTW], ["zh-HK", zhHK]]) {
  test(`${name} translates every read-only string into Chinese`, () => {
    for (const key of readOnly) {
      expect(catalog[key], `${name}: ${key}`).toBeTruthy();
      expect(catalog[key]).toMatch(/^唯讀檢視。/);
      expect(catalog[key]).not.toBe(key);
    }
  });
}

test("every t() literal in the screen has a zh-TW and zh-HK entry", () => {
  const keys = new Set([...source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]));
  const missing = [...keys].filter((k) => !(k in zhTW) || !(k in zhHK));
  expect(missing).toEqual([]);
});
