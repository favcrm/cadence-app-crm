// CRM-23: a declared view's params become list filters, and a filter becomes params.
// Run: bun test tests/unit/route_params.test.mjs

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { queryPatch, readQueryParams, readRecordParam, hasParams } from "../../src/domain/routeParams.ts";
import { views } from "../../scripts/crm_views.mjs";

test("customers take only q; filters the list cannot apply server-side are not params", () => {
  expect(readQueryParams({ q: " ann ", consent: "denied", tag: "vip", source: "pos" })).toEqual({ q: "ann" });
  expect(readQueryParams({ q: "x".repeat(201) })).toEqual({ q: "" });
  expect(readQueryParams({ q: "a\u0007b" })).toEqual({ q: "" });
  expect(readQueryParams(undefined)).toEqual({ q: "" });
});

test("segments and campaigns take only q", () => {
  expect(readQueryParams({ q: "spring", tag: "vip" })).toEqual({ q: "spring" });
  expect(queryPatch({ q: "spring" })).toEqual({ q: "spring" });
  expect(queryPatch({ q: "" })).toEqual({});
});

test("segment and campaign views name a record by a valid id only", () => {
  expect(readRecordParam({ id: "spring-2026" })).toBe("spring-2026");
  expect(readRecordParam({ id: "../x" })).toBeNull();
  expect(readRecordParam({ id: "" })).toBeNull();
  expect(readRecordParam({})).toBeNull();
  expect(hasParams({})).toBe(false);
  expect(hasParams({ q: "a" })).toBe(true);
});

test("declared views are valid and only name what the screens apply", () => {
  const screens = JSON.parse(readFileSync(new URL("../../app/screens/crm/screens.json", import.meta.url), "utf8"));
  expect(screens.views).toEqual(views);
  const sections = screens.navigation.sections.map((s) => s.id);
  expect(views.length).toBeLessThanOrEqual(20);
  expect(new Set(views.map((v) => v.id)).size).toBe(views.length);
  for (const view of views) {
    expect(view.id).toMatch(/^[a-z0-9_-]{1,32}$/);
    expect(sections).toContain(view.section);
    expect(view.label.en.length).toBeLessThanOrEqual(60);
    expect(view.label["zh-TW"].length).toBeGreaterThan(0);
    const names = Object.keys(view.params);
    expect(names.length).toBeLessThanOrEqual(6);
    for (const name of names) expect(name).toMatch(/^[a-z_]{1,24}$/);
    for (const param of Object.values(view.params)) {
      expect(["date", "string", "enum"]).toContain(param.type);
      if (param.type === "enum") expect(param.values.length).toBeLessThanOrEqual(20);
    }
  }
  // Exactly the server-side filters the lists apply: no sort, status, segment, tag, consent or source.
  // records.list takes only query/limit/cursor, so customers declare only q.
  expect(Object.keys(views.find((v) => v.id === "customers").params)).toEqual(["q"]);
});
