// CRM-19: the screen follows its frame width (the chat canvas is ~420-830px),
// not the host viewport. Run: bun test tests/unit/canvas_layout.test.mjs
import { test, expect, beforeAll, afterAll, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", () => ({
  ...sdkMock(),
  DrawerShell: ({ kicker, onClose }) => globalThis.React.createElement("div", { "data-testid": "shell" }, kicker, globalThis.React.createElement("button", { onClick: onClose }, "close")),
}));

let React, createRoot, act, useContainerWidth, STACK_BELOW_PX, FrameDrawer, observers;
beforeAll(async () => {
  GlobalRegistrator.register();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { observers = observers.filter((o) => o !== this); }
  };
  React = await import("react");
  globalThis.React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = React);
  ({ useContainerWidth, STACK_BELOW_PX } = await import("../../src/features/crm/containerWidth.ts"));
  FrameDrawer = (await import("../../src/features/crm/FrameDrawer.tsx")).default;
});
afterAll(() => GlobalRegistrator.unregister());

const frameWidth = (px) => Object.defineProperty(window, "innerWidth", { value: px, configurable: true });

test("the container width is the frame width and follows resizes", async () => {
  frameWidth(704);
  let seen = [];
  const Probe = () => { seen.push(useContainerWidth()); return null; };
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Probe)));
  expect(seen.at(-1)).toBe(704);
  expect(seen.at(-1) < STACK_BELOW_PX).toBe(true);
  frameWidth(1280);
  await act(async () => observers.forEach((o) => o.callback([])));
  expect(seen.at(-1)).toBe(1280);
  expect(seen.at(-1) < STACK_BELOW_PX).toBe(false);
  await act(async () => root.unmount());
  expect(observers.length).toBe(0);
});

test("a filled drawer carries a Back control that closes it; the default drawer has none", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let closed = 0;
  const props = { kind: "customer", label: "Customer details", title: "Ada", tabs: [], onClose: () => { closed += 1; } };
  await act(async () => root.render(React.createElement(FrameDrawer, { ...props, fill: { backLabel: "Customers" } })));
  expect(host.querySelector(".crm-frame-drawer").hasAttribute("data-fill")).toBe(true);
  const back = host.querySelector(".crm-drawer-back");
  expect(back.textContent).toContain("Customers");
  await act(async () => back.click());
  expect(closed).toBe(1);
  await act(async () => root.render(React.createElement(FrameDrawer, props)));
  expect(host.querySelector(".crm-frame-drawer").hasAttribute("data-fill")).toBe(false);
  expect(host.querySelector(".crm-drawer-back")).toBeNull();
  await act(async () => root.unmount());
});
