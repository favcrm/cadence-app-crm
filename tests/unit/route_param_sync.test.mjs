// CRM-23: a list's filters follow the route's params, and a filter the user changes
// is patched back with `screen.route.patch {params}`. Run: bun test tests/unit/route_param_sync.test.mjs
import { test, expect, beforeAll, afterAll, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);
const patches = [];
let routeParams = {};
const listeners = new Set();
mock.module("../../src/bridge/route.ts", () => ({ patchRoute: (patch) => { patches.push(patch); return Promise.resolve({}); } }));
mock.module("../../src/bridge/scope.ts", () => ({
  useScope: () => { const [, force] = globalThis.React.useReducer((n) => n + 1, 0); globalThis.React.useEffect(() => { listeners.add(force); return () => listeners.delete(force); }, []); return { route: { params: routeParams } }; },
}));

let React, createRoot, act, useRouteParamSync, params;
beforeAll(async () => {
  GlobalRegistrator.register();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import("react");
  globalThis.React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = React);
  ({ useRouteParamSync } = await import("../../src/features/crm/useRouteParams.ts"));
  params = await import("../../src/domain/routeParams.ts");
});
afterAll(() => GlobalRegistrator.unregister());

let setQ;
const Probe = ({ seen }) => {
  const initial = params.readQueryParams(routeParams);
  const [q, set] = React.useState(initial.q);
  setQ = set;
  seen.push(q);
  useRouteParamSync({ q }, params.readQueryParams, params.queryPatch, (next) => set(next.q));
  return null;
};
const mount = async (seen) => { const root = createRoot(document.createElement("div")); await act(async () => root.render(React.createElement(Probe, { seen }))); return root; };
// The write-back runs on a timer (zero delay here), so let it fire.
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const pushRoute = async (next) => { routeParams = next; await act(async () => listeners.forEach((f) => f())); };

test("opening with params starts filtered and writes nothing back", async () => {
  patches.length = 0; routeParams = { q: "vip", bogus: "1" };
  const seen = [];
  await mount(seen);
  expect(seen[0]).toBe("vip");
  expect(patches).toEqual([]);
});

test("a filter the user changes is patched back as the whole params set", async () => {
  patches.length = 0; routeParams = { q: "vip" };
  await mount([]);
  await act(async () => setQ("new")); await tick();
  expect(patches).toEqual([{ params: { q: "new" } }]);
  await act(async () => setQ("")); await tick();
  expect(patches.at(-1)).toEqual({ params: {} });
});

test("the echo of our own patch is not re-applied, an outside change is", async () => {
  patches.length = 0; routeParams = {};
  const seen = [];
  await mount(seen);
  await act(async () => setQ("a")); await tick();
  expect(patches).toEqual([{ params: { q: "a" } }]);
  await pushRoute({ q: "a" });
  expect(patches.length).toBe(1);
  await pushRoute({ q: "b" });
  expect(seen.at(-1)).toBe("b");
  expect(patches.length).toBe(1);
});

test("an invalid value in the route is ignored, leaving the default", async () => {
  patches.length = 0; routeParams = { q: "a\u0007b" };
  const seen = [];
  await mount(seen);
  expect(seen[0]).toBe("");
  expect(patches).toEqual([]);
});
