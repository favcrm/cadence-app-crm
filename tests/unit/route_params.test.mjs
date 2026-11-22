// CRM-23: a declared view's params become list filters, and a filter becomes params.
// Run: bun test tests/unit/route_params.test.mjs

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { customerPatch, queryPatch, readCustomerParams, readQueryParams, readRecordParam, hasParams } from "../../src/domain/routeParams.ts";
import { views } from "../../scripts/crm_views.mjs";

test("customers params become filters; unusable values are ignored", () => {
  expect(readCustomerParams({ q: " ann ", consent: "denied", source: "pos", tag: "vip" })).toEqual({ q: "ann", consent: "denied", source: "pos", tag: "vip" });
  expect(readCustomerParams({ consent: "maybe", q: "x".repeat(201), tag: "a\u0007b", source: "" })).toEqual({ q: "", consent: "", source: "", tag: "" });
  expect(readCustomerParams(undefined)).toEqual({ q: "", consent: "", source: "", tag: "" });
  expect(readCustomerParams({ sort: "name", status: "x" })).toEqual({ q: "", consent: "", source: "", tag: "" });
});

test("a changed filter is written back as params, empty ones dropped, and the round trip is stable", () => {
  const state = { q: "ann", consent: "granted", source: "", tag: "vip" };
  expect(customerPatch(state)).toEqual({ q: "ann", consent: "granted", tag: "vip" });
  expect(readCustomerParams(customerPatch(state))).toEqual(state);
  expect(customerPatch({ q: "", consent: "", source: "", tag: "" })).toEqual({});
  expect(customerPatch({ q: "x".repeat(201), consent: "bad", source: "", tag: "" })).toEqual({});
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
  // Exactly the filters the lists already apply: no sort, status or segment on customers.
  expect(Object.keys(views.find((v) => v.id === "customers").params)).toEqual(["q", "consent", "source", "tag"]);
  expect(views.find((v) => v.id === "customers").params.consent.values).toEqual(["granted", "unknown", "denied"]);
});
