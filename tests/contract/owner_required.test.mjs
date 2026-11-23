// CRM-28: a member's owner-only reads (segments, campaigns) are refused `owner_required`.
// That section shows one calm owner-only state; customers keep loading in the same mount.
// Run: bun test tests/contract/owner_required.test.mjs
import { test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { ApiError, sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let section = "customers";
let canvas = false;
let locale = "en";
let refuse = {};
const calls = [];
const scopeListeners = new Set();
const scope = { installId: "i1", digest: "d1" };
mock.module("../../src/bridge/scope.ts", () => ({
  useScope: () => {
    const [, force] = globalThis.React.useReducer((n) => n + 1, 0);
    globalThis.React.useEffect(() => { scopeListeners.add(force); return () => scopeListeners.delete(force); }, []);
    return { scope, digest: "d1", presentationLocale: locale, observations: [], actions: ["records.list", "segments.list", "content.list"], route: { section, view: "list", record_id: null, segment_id: null, params: {} } };
  },
  useCanvasReadOnly: () => canvas,
  scopeError: () => null,
  assertCurrentScope: () => undefined,
  requireOperation: () => undefined,
  onScopeRetired: () => () => undefined,
  bindBridgeScope: () => undefined,
}));
mock.module("../../src/bridge/route.ts", () => ({ patchRoute: () => Promise.resolve({}), FrameNavigationAdapter: {} }));
mock.module("../../src/bridge/channel.ts", () => ({
  channel: {
    onWrite: () => () => undefined,
    call: (_scope, verb) => {
      calls.push(verb);
      const code = refuse[verb] ?? refuse[verb.split(".")[0]];
      if (code) return Promise.reject(new ApiError("refused", code === "forbidden" ? 403 : code === "owner_required" ? 403 : 500, { code }));
      return Promise.resolve({ ok: true });
    },
  },
}));

let React, createRoot, act, CrmScreen, gate;
beforeAll(async () => {
  GlobalRegistrator.register();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import("react");
  globalThis.React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = React);
  const { serviceCall } = await import("../../src/bridge/services.ts");
  // Each section stub does what the real one does first: one read through serviceCall.
  const stub = (label, verb) => () => {
    const [state, set] = React.useState("loading");
    React.useEffect(() => { serviceCall(scope, verb, {}).then(() => set(`${label} loaded`), () => set(`${label} failed`)); }, []);
    return React.createElement("p", { "data-section": label }, state);
  };
  mock.module("../../src/features/crm/customers/Customers.tsx", () => ({ default: stub("customers", "records.list") }));
  mock.module("../../src/features/crm/deals/Deals.tsx", () => ({ default: stub("deals", "records.list") }));
  mock.module("../../src/features/crm/tasks/Tasks.tsx", () => ({ default: stub("tasks", "records.list") }));
  mock.module("../../src/features/crm/segments/Segments.tsx", () => ({ default: stub("segments", "segments.list") }));
  mock.module("../../src/features/crm/campaigns/CrmCampaigns.tsx", () => ({ default: stub("campaigns", "content.list") }));
  gate = await import("../../src/bridge/ownerGate.ts");
  ({ default: CrmScreen } = await import("../../src/features/crm/CrmScreen.tsx"));
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => { gate.resetOwnerGate(); calls.length = 0; refuse = {}; canvas = false; locale = "en"; section = "customers"; });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const open = async (next) => {
  const root = createRoot(document.createElement("div"));
  const host = document.createElement("div");
  document.body.append(host);
  const r = createRoot(host);
  section = next;
  await act(async () => r.render(React.createElement(CrmScreen)));
  await settle();
  return { host, go: async (to) => { section = to; await act(async () => scopeListeners.forEach((f) => f())); await settle(); }, close: () => act(async () => { r.unmount(); host.remove(); root.unmount(); }) };
};
const OWNER = { segments: "Only workspace owners can view segments.", campaigns: "Only workspace owners can view campaigns." };

test("owner_required on a section's first read shows its owner-only state, on the page and in the canvas", async () => {
  for (const isCanvas of [false, true]) for (const name of ["segments", "campaigns"]) {
    canvas = isCanvas; gate.resetOwnerGate();
    refuse = { segments: "owner_required", content: "owner_required" };
    const screen = await open(name);
    const text = screen.host.textContent;
    expect(text).toContain(OWNER[name]);
    expect(text).toContain("Ask a workspace owner if you need this.");
    expect(text).not.toContain("failed");
    expect(screen.host.querySelector("main.crm").dataset.state).toBe("owner-only");
    expect(screen.host.querySelector("main.crm").classList.contains("crm-canvas")).toBe(isCanvas);
    expect(screen.host.querySelectorAll("button").length).toBe(0);
    const before = calls.length;
    await settle();
    expect(calls.length).toBe(before); // no retry loop
    await screen.close();
  }
});

test("customers still load in the same mount after a section is refused, and the refused section stays gated", async () => {
  refuse = { segments: "owner_required", content: "owner_required" };
  const screen = await open("segments");
  expect(screen.host.textContent).toContain(OWNER.segments);
  await screen.go("customers");
  expect(screen.host.textContent).toContain("customers loaded");
  expect(screen.host.textContent).not.toContain("Only workspace owners");
  await screen.go("campaigns");
  expect(screen.host.textContent).toContain(OWNER.campaigns);
  await screen.go("segments");
  expect(screen.host.textContent).toContain(OWNER.segments);
  await screen.close();
});

test("an owner sees every section: nothing refused, nothing gated", async () => {
  const screen = await open("segments");
  expect(screen.host.textContent).toContain("segments loaded");
  await screen.go("campaigns");
  expect(screen.host.textContent).toContain("campaigns loaded");
  await screen.close();
});

test("the owner-only state is written in zh-TW and zh-HK", async () => {
  refuse = { segments: "owner_required", content: "owner_required" };
  for (const loc of ["zh-TW", "zh-HK"]) {
    locale = loc; gate.resetOwnerGate();
    let screen = await open("segments");
    expect(screen.host.textContent).toContain("只有工作區擁有者可以查看客戶分群。");
    expect(screen.host.textContent).toContain("如有需要，請向工作區擁有者查詢。");
    await screen.close();
    screen = await open("campaigns");
    expect(screen.host.textContent).toContain("只有工作區擁有者可以查看行銷活動。");
    await screen.close();
  }
});

test("other refusals of a read do not show the owner-only state", async () => {
  for (const code of ["forbidden", "unavailable", "failed"]) {
    gate.resetOwnerGate();
    refuse = { segments: code, content: code };
    for (const name of ["segments", "campaigns"]) {
      const screen = await open(name);
      expect(screen.host.textContent).not.toContain("Only workspace owners");
      expect(screen.host.querySelector('[data-state="owner-only"]')).toBeNull();
      await screen.close();
    }
  }
});

test("a refused write or records read never gates a section", async () => {
  refuse = { records: "owner_required", "segments.save": "owner_required" };
  const screen = await open("customers");
  expect(screen.host.textContent).not.toContain("Only workspace owners");
  const { serviceCall } = await import("../../src/bridge/services.ts");
  await serviceCall(scope, "segments.save", { segment_id: "s", name: "n", predicates: [] }).catch(() => undefined);
  await settle();
  expect(gate.getOwnerRefused().size).toBe(0);
  await screen.close();
});
