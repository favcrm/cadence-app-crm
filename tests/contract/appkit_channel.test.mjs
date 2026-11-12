// Contract tests for the app-kit-backed CRM channel. The synthetic host here
// speaks the real records wire: ready, PUSH, call replies and slot events.
// Run: bun test tests/contract/appkit_channel.test.mjs

import { test, expect, mock } from "bun:test";
import { ApiError, sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

const { createChannel } = await import("../../src/bridge/channel.ts");
const { clearScope, getScope } = await import("../../src/bridge/scope.ts");

const DIGEST = "sha256:" + "a".repeat(64);
const boot = {
  tag: "crm",
  bridge_nonce: "b".repeat(64),
  generation: 1,
  parent_origin: "https://board.example",
};

const push = (extra = {}) => ({
  v: 2,
  op: "screen",
  install_id: "install-test",
  digest: DIGEST,
  tag: "crm",
  installation: { install_id: "install-test", name: "crm", title: "CRM", version: "0.4.0", digest: DIGEST, summary: "s" },
  contexts: [],
  runs: [],
  outbox: [],
  publish_intents: [],
  sources: [],
  defaults: [],
  readiness: [],
  actions: ["records.list", "records.show", "records.csv.preview", "content.approve"],
  now: "2026-11-05T00:00:00Z",
  resume: null,
  route: { section: "customers", view: "list", record_id: null, segment_id: null },
  read_observations: [],
  presentation_locale: "en",
  ...extra,
});

const waitFor = async (find, label) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = find();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

function installEnvironment() {
  let host;
  const events = [];
  const parent = {
    postMessage(message, _origin, transfer) {
      if (message.op !== "init") return;
      host = transfer?.[0];
      host.onmessage = (event) => events.push(event.data);
      host.start?.();
    },
  };
  const windowRef = { parent, addEventListener() {} };
  globalThis.window = windowRef;
  globalThis.parent = parent;
  globalThis.document = {
    getElementById: (id) => (id === "cadence-screen-boot" ? { textContent: JSON.stringify(boot) } : null),
  };
  return { events, host: () => host, windowRef };
}

async function mount() {
  clearScope("test reset");
  const env = installEnvironment();
  const channel = createChannel();
  channel.start();
  const ready = await waitFor(() => env.events.find((event) => event.op === "ready"), "ready");
  expect(ready.accepts).toEqual(["screen.v2", "screen-records.v1", "screen-locale.v1"]);
  env.host().postMessage(push());
  await waitFor(() => getScope()?.scope.installId === "install-test", "PUSH scope");
  return { channel, ...env };
}

const retire = (channel) => channel.retire(new ApiError("test cleanup", 403));

test("mounts with records capabilities and completes a call", async () => {
  const { channel, events, host } = await mount();
  try {
    const pending = channel.request("call", "records.list", {});
    const request = await waitFor(() => events.find((event) => event.op === "call"), "call");
    expect(request.verb).toBe("records.list");
    host().postMessage({ v: 2, op: "reply", id: request.id, ok: true, data: { items: [] } });
    await expect(pending).resolves.toEqual({ items: [] });
  } finally {
    retire(channel);
  }
});

test("a slot resolves its data, and a refusal maps to ApiError", async () => {
  const { channel, events, host } = await mount();
  try {
    const done = channel.request("slot", "content.approve", { campaign_id: "c1", expected_revision: 2 });
    const doneRequest = await waitFor(() => events.find((event) => event.op === "slot" && !event.replied), "done slot");
    doneRequest.replied = true;
    host().postMessage({ v: 2, op: "slot-state", id: doneRequest.id, state: "done", data: { receipt: "r1" } });
    await expect(done).resolves.toEqual({ receipt: "r1" });

    const refused = channel.request("call", "records.show", { record_id: "missing" });
    const refusedRequest = await waitFor(
      () => events.find((event) => event.op === "call" && event.verb === "records.show"),
      "refused call",
    );
    host().postMessage({ v: 2, op: "reply", id: refusedRequest.id, ok: false, refusal: { code: "conflict", text: "stale" } });
    await expect(refused).rejects.toMatchObject({ status: 409, code: "conflict" });
  } finally {
    retire(channel);
  }
});

test("an authorization refusal retires the mount and clears scope", async () => {
  const { channel, events, host } = await mount();
  try {
    const pending = channel.request("call", "records.list", {});
    const request = await waitFor(() => events.find((event) => event.op === "call"), "call");
    host().postMessage({ v: 2, op: "reply", id: request.id, ok: false, refusal: { code: "unauthorized", text: "expired" } });
    await expect(pending).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(getScope()).toBeNull();
    await expect(channel.request("call", "records.list", {})).rejects.toMatchObject({ status: 503 });
  } finally {
    retire(channel);
  }
});

test("caps in-flight requests at eight", async () => {
  const { channel } = await mount();
  const pending = [];
  try {
    for (let index = 0; index < 8; index += 1) pending.push(channel.request("call", "records.list", {}));
    await expect(channel.request("call", "records.list", {})).rejects.toMatchObject({ status: 429 });
  } finally {
    retire(channel);
    await Promise.allSettled(pending);
  }
});

test("allows one large CSV request at a time", async () => {
  const { channel } = await mount();
  let csv;
  try {
    csv = channel.request("call", "records.csv.preview", { csv_text: "a" });
    await expect(channel.request("call", "records.csv.preview", { csv_text: "b" })).rejects.toMatchObject({ status: 429 });
  } finally {
    retire(channel);
    if (csv) await Promise.allSettled([csv]);
  }
});

test("secret fields in a reply refuse and retire the mount", async () => {
  const { channel, events, host } = await mount();
  try {
    const pending = channel.request("call", "records.list", {});
    const request = await waitFor(() => events.find((event) => event.op === "call"), "call");
    host().postMessage({ v: 2, op: "reply", id: request.id, ok: true, data: { confirmation_token: "nope" } });
    await expect(pending).rejects.toMatchObject({ status: 502 });
    expect(getScope()).toBeNull();
  } finally {
    retire(channel);
  }
});

test("ownCampaignLeaveState publishes generic v2 leave hints and clears on release", async () => {
  const { channel, events } = await mount();
  try {
    const leave = channel.ownCampaignLeaveState();
    expect(leave).toBeTruthy();
    leave.publish(true);
    leave.release();
    await waitFor(() => events.filter((event) => event.op === "leave").length === 2, "leave events");
    expect(events.filter((event) => event.op === "leave")).toEqual([
      { v: 2, op: "leave", unsaved: true },
      { v: 2, op: "leave", unsaved: false },
    ]);
  } finally {
    retire(channel);
  }
});
