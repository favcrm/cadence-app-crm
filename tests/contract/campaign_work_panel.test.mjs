// CRM-12 campaign-work panel behavior, driven through the real client and
// domain with the bridge channel as the seam.
// Run: bun test tests/contract/campaign_work_panel.test.mjs
//
// happy-dom supplies a DOM; React runs for real. The shared SDK controls are
// stubbed because only the browser frame supplies them, and `channel.request`
// is replaced by a small host that stores the row with the same domain
// functions, so every request body the panel produces is observable.

import { test, expect, beforeAll, afterEach, mock } from "bun:test";
import { createElement } from "react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { ApiError, sdkMock } from "../support/sdk-mock.mjs";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@cadence/screen-ui", sdkMock);

const DIGEST = "sha256:" + "a".repeat(64);
const AT = "2026-10-25T09:00:00.000Z";
const AT2 = "2026-10-27T09:00:00.000Z";
const scope = { installId: "inst-1", digest: DIGEST };
const readiness = [
  { key: "draft", done: true },
  { key: "freeze", done: true },
  { key: "sender", done: true },
  { key: "test", done: false },
];

let react;
let reactDom;
let panel;
let domain;
let scopeModule;
let channelModule;
beforeAll(async () => {
  react = await import("react");
  reactDom = await import("react-dom/client");
  panel = await import("../../src/features/crm/campaigns/CampaignWorkPanel.tsx");
  domain = await import("../../src/domain/campaignWork.ts");
  scopeModule = await import("../../src/bridge/scope.ts");
  channelModule = await import("../../src/bridge/channel.ts");
  scopeModule.acceptPush({
    v: 1,
    op: "push",
    install_id: "inst-1",
    digest: DIGEST,
    tag: "crm",
    installation: { install_id: "inst-1", name: "crm", title: "CRM", version: "0.2.1", digest: DIGEST, summary: "s" },
    runs: [],
    outbox: [],
    publish_intents: [],
    sources: [],
    defaults: [],
    readiness: [],
    actions: ["campaign-work.show", "campaign-work.save"],
    now: AT,
    resume: null,
    route: { section: "campaigns", view: "list", record_id: null, segment_id: null },
    read_observations: [],
  });
});

const mounted = [];
afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await react.act(async () => entry.root.unmount());
    entry.container.remove();
  }
});

const settle = () => react.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

async function mount({ canWrite = true } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = reactDom.createRoot(container);
  const node = createElement(panel.default, { scope, campaignId: "welcome", canWrite, readiness });
  await react.act(async () => root.render(node));
  await settle();
  mounted.push({ root, container });
  return container;
}

const label = (text) => container => container.querySelector(`#field-${text.replace(/[^A-Za-z0-9]+/g, "-")}`);

async function type(container, name, value) {
  const input = label(name)(container);
  // React's value tracker ignores a direct `.value` write; go through the
  // native setter so the change is real to the controlled input.
  const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set;
  await react.act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(container) {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  await react.act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

function makeHost(initial) {
  const calls = [];
  let work = initial;
  let failure = null;
  let showFailure = null;
  let show = null;
  const view = () => show ?? {
    contract: domain.WORK_CONTRACT,
    source: { app: "crm", install_id: "inst-1", context_id: null },
    campaign_id: "welcome",
    work: work === null ? null : {
      revision: work.revision,
      content_revision: work.contentRevision,
      assignee: work.assignee,
      assigned_by: work.assignedBy,
      assigned_at: work.assignedAt,
      due_at: work.dueAt,
      status: work.status,
      blocked_reason: work.blockedReason,
      updated_at: work.updatedAt,
    },
    content: { revision: 4, digest: DIGEST },
  };
  const request = (_kind, verb, args) => {
    calls.push({ verb, args });
    if (failure !== null) return Promise.reject(failure);
    if (verb === "campaign-work.show" && showFailure !== null) {
      const error = showFailure;
      showFailure = null;
      return Promise.reject(error);
    }
    if (verb === "campaign-work.show") return Promise.resolve(view());
    if (verb === "campaign-work.save") {
      try {
        domain.assertWorkRevision(work, args.expected_revision);
      } catch (error) {
        return Promise.reject(error);
      }
      const patch = {};
      if ("assignee" in args) patch.assignee = args.assignee;
      if ("due_at" in args) patch.dueAt = args.due_at;
      if ("status" in args) patch.status = args.status;
      if ("blocked_reason" in args) patch.blockedReason = args.blocked_reason;
      work = domain.applyWorkWrite(work, patch, { actor: "operator", at: AT2 }, 4);
      return Promise.resolve(view());
    }
    return Promise.reject(new ApiError("unexpected operation", 400));
  };
  return {
    calls,
    request,
    saves: () => calls.filter((call) => call.verb === "campaign-work.save"),
    get work() { return work; },
    setWork(next) { work = next; },
    failWith(error) { failure = error; },
    failNextShow(error) { showFailure = error; },
    replyWith(reply) { show = reply; },
  };
}

const blocked = () => domain.applyWorkWrite(
  null,
  { assignee: "Ada", dueAt: "2026-11-01", status: "blocked", blockedReason: "waiting on legal" },
  { actor: "owner", at: AT },
  4,
);

test("a reason-only edit on a blocked row saves with status and increments the revision", async () => {
  const host = makeHost(blocked());
  channelModule.channel.request = host.request;
  const container = await mount();
  expect(container.textContent).toContain("Blocked");

  await type(container, "Blocked reason", "waiting on finance");
  await submit(container);

  expect(host.saves()).toHaveLength(1);
  expect(host.saves()[0].args).toEqual({
    campaign_id: "welcome",
    expected_revision: 1,
    status: "blocked",
    blocked_reason: "waiting on finance",
  });
  expect(host.work.revision).toBe(2);
  expect(host.work.blockedReason).toBe("waiting on finance");
  expect(container.textContent).toContain("waiting on finance");
  expect(container.textContent).toContain("Unblock: waiting on finance");
  expect(container.textContent).toContain("Revision 2");
});

test("a refused value shows an error, keeps the controls usable, and saves after correction", async () => {
  const host = makeHost(null);
  channelModule.channel.request = host.request;
  const container = await mount();

  await type(container, "Due date", "2026-02-30");
  await submit(container);
  expect(host.saves()).toHaveLength(0);
  expect(container.querySelector("[role='alert']")?.textContent).toContain("calendar day");
  const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save work");
  expect(save.disabled).toBe(false);

  await type(container, "Due date", "2026-11-02");
  await submit(container);
  expect(host.saves()).toHaveLength(1);
  expect(host.saves()[0].args).toEqual({ campaign_id: "welcome", expected_revision: 0, due_at: "2026-11-02" });
  expect(container.textContent).toContain("2026-11-02");
  expect(label("Due date")(container).value).toBe("2026-11-02");

  await type(container, "Assigned to", "<Ada>");
  await submit(container);
  expect(host.saves()).toHaveLength(1);
  expect(container.querySelector("[role='alert']")?.textContent).toContain("plain text");

  await type(container, "Assigned to", "Ada Chen");
  await submit(container);
  expect(host.saves()).toHaveLength(2);
  expect(host.saves()[1].args).toEqual({ campaign_id: "welcome", expected_revision: 1, assignee: "Ada Chen" });
  expect(container.textContent).toContain("Ada Chen");
});

test("a stale save writes nothing, re-reads, keeps the edits and the conflict notice", async () => {
  const host = makeHost(domain.applyWorkWrite(null, { assignee: "Ada" }, { actor: "owner", at: AT }, 4));
  channelModule.channel.request = host.request;
  const container = await mount();

  await type(container, "Assigned to", "Bea");
  // Another writer lands between the read and this save.
  host.setWork(domain.applyWorkWrite(host.work, { assignee: "Cy" }, { actor: "other", at: AT2 }, 5));
  await submit(container);

  expect(host.saves()).toHaveLength(1);
  expect(host.saves()[0].args).toEqual({ campaign_id: "welcome", expected_revision: 1, assignee: "Bea" });
  expect(host.work.revision).toBe(2);
  expect(host.work.assignee).toBe("Cy");
  const alerts = [...container.querySelectorAll("[role='alert']")].map((node) => node.textContent).join(" ");
  expect(alerts).toContain("These details changed; nothing was saved.");
  expect(alerts).toContain("Current revision 2.");
  // The operator's attempted value is still there; the recorded value is
  // shown beside it rather than replacing it silently.
  expect(label("Assigned to")(container).value).toBe("Bea");
  expect(container.querySelector("section").textContent).toContain("Cy · No due date · Status not set");
});

test("after a stale re-read, untouched inputs take the new baseline and the next save sends only the edited field", async () => {
  const host = makeHost(domain.applyWorkWrite(
    null,
    { assignee: "Ada", dueAt: "2026-11-01", status: "in_progress" },
    { actor: "owner", at: AT },
    4,
  ));
  channelModule.channel.request = host.request;
  const container = await mount();

  await type(container, "Assigned to", "Bea");
  // Another writer moves the due date and completes the campaign.
  host.setWork(domain.applyWorkWrite(
    host.work,
    { dueAt: "2026-12-15", status: "done" },
    { actor: "other", at: AT2 },
    4,
  ));
  await submit(container);

  expect(host.saves()).toHaveLength(1);
  // The re-read refreshed only the fields the operator did not touch.
  expect(label("Assigned to")(container).value).toBe("Bea");
  expect(label("Due date")(container).value).toBe("2026-12-15");
  expect(label("Status")(container).value).toBe("done");
  const alerts = [...container.querySelectorAll("[role='alert']")].map((node) => node.textContent).join(" ");
  expect(alerts).toContain("Current revision 2.");

  // The follow-up save carries the operator's edit only, so the other
  // writer's due date and completion survive.
  await submit(container);
  expect(host.saves()).toHaveLength(2);
  expect(host.saves()[1].args).toEqual({ campaign_id: "welcome", expected_revision: 2, assignee: "Bea" });
  expect(host.work.assignee).toBe("Bea");
  expect(host.work.dueAt).toBe("2026-12-15");
  expect(host.work.status).toBe("done");
  expect(host.work.revision).toBe(3);
});

test("a failed conflict re-read keeps the edits and the notice, and Retry preserves both", async () => {
  const host = makeHost(domain.applyWorkWrite(
    null,
    { assignee: "Ada", dueAt: "2026-11-01" },
    { actor: "owner", at: AT },
    4,
  ));
  channelModule.channel.request = host.request;
  const container = await mount();

  await type(container, "Assigned to", "Bea");
  host.setWork(domain.applyWorkWrite(host.work, { dueAt: "2026-12-15" }, { actor: "other", at: AT2 }, 4));
  host.failNextShow(new ApiError("Unavailable offline.", 503, { code: "unavailable" }));
  await submit(container);

  const alerts = () => [...container.querySelectorAll("[role='alert']")].map((node) => node.textContent).join(" ");
  expect(alerts()).toContain("These details changed; nothing was saved.");
  expect(alerts()).toContain("Unavailable offline.");
  expect(label("Assigned to")(container).value).toBe("Bea");
  const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save work");
  // No save against a baseline the panel could not re-read.
  expect(save.disabled).toBe(true);

  const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry");
  await react.act(async () => retry.click());
  await settle();
  expect(container.textContent).not.toContain("Unavailable offline.");
  expect(label("Assigned to")(container).value).toBe("Bea");
  expect(label("Due date")(container).value).toBe("2026-12-15");
  expect(alerts()).toContain("Current revision 2.");

  await submit(container);
  expect(host.saves()).toHaveLength(2);
  expect(host.saves()[1].args).toEqual({ campaign_id: "welcome", expected_revision: 2, assignee: "Bea" });
  expect(host.work.dueAt).toBe("2026-12-15");
});

test("a failed read is an explicit alert for writable and read-only viewers, with recovery", async () => {
  const host = makeHost(domain.applyWorkWrite(null, { assignee: "Ada" }, { actor: "owner", at: AT }, 4));
  host.failWith(new ApiError("Unavailable offline.", 503, { code: "unavailable" }));
  channelModule.channel.request = host.request;
  const writable = await mount({ canWrite: true });
  expect(writable.querySelector("[role='alert']")?.textContent).toContain("Unavailable offline.");
  expect(writable.textContent).not.toContain("Unassigned");
  expect(writable.querySelector("form")).toBeNull();

  const readOnly = await mount({ canWrite: false });
  expect(readOnly.querySelector("[role='alert']")?.textContent).toContain("Unavailable offline.");
  expect(readOnly.textContent).not.toContain("Unassigned");

  // Recovery: a healthy retry loads the recorded row.
  host.failWith(null);
  const retry = [...writable.querySelectorAll("button")].find((button) => button.textContent === "Retry");
  await react.act(async () => retry.click());
  await settle();
  expect(writable.textContent).toContain("Ada");
  expect(writable.querySelector("[role='alert']")).toBeNull();
});

test("a malformed reply is an explicit failure, never an empty work row", async () => {
  const host = makeHost(null);
  host.replyWith({ contract: "crm-campaign-work/v2" });
  channelModule.channel.request = host.request;
  const container = await mount({ canWrite: false });
  expect(container.querySelector("[role='alert']")?.textContent).toContain("campaign work reply is invalid");
  expect(container.textContent).not.toContain("Unassigned");
});
