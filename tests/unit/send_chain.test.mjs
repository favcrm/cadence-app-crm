// CRM-16 send chain: the store that outlives the page, the count-mismatch retry
// and what is claimed after a failed confirmation, run against a fake host that
// answers with the real wire shapes: native `crm_send_list` / `send_view` and
// hosted `crmSendView` (no counts, `created_at`).
// Run: bun test tests/unit/send_chain.test.mjs
import { test, expect, beforeAll, beforeEach, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

const host = { shape: "native", frozen: 100, sends: [], log: [], holdList: null, approve: null, showFails: false, listFails: false, prepareFails: null, showStates: null };
const doc = () => ({ content: { campaign_id: "c1", revision: 2, subject: "s", preheader: "", blocks: [{ type: "paragraph", text: "x" }], content_digest: "d", approval: { revision: 2, digest: "d", valid: true, scope: "content-only" } } });
const SEND_COLUMNS = (s) => ({ send_id: s.send_id, campaign_id: "c1", request_id: s.request_id, content_revision: 2, content_digest: "d", audience_freeze_id: s.freeze, audience_digest: "a", connection_id: "conn", link_revision: 1, send_digest: "x", unsubscribe_origin: "https://o", state: s.state });
const listRow = (s) => host.shape === "native"
  ? { send_id: s.send_id, campaign_id: "c1", state: s.state, send_digest: "x", created: s.n, approved_at: s.state === "prepared" ? null : 1, counts: { queued: 0, submitting: 0, accepted: s.accepted ?? 0, failed: 0, uncertain: 0, suppressed: 0, closed: 0 }, delivery_claim: "smtp-acceptance-only" }
  : { ...SEND_COLUMNS(s), created_at: s.n, approved_at: s.state === "prepared" ? null : 1 };
const err = async (message, status, code) => { const { ApiError } = await import("@cadence/screen-ui"); return new ApiError(message, status, code === undefined ? undefined : { code }); };
mock.module("../../src/bridge/services.ts", () => ({
  serviceCall: async (_scope, verb, args) => {
    host.log.push(verb);
    if (verb === "content.show") return doc();
    if (verb === "sends.list") { if (host.holdList) await host.holdList; if (host.listFails) throw await err("down", 503, "unavailable"); return { sends: host.sends.map(listRow) }; }
    if (verb === "sends.show") {
      if (host.showFails) throw await err("down", 503, "unavailable");
      const s = host.sends.find((x) => x.send_id === args.send_id);
      if (host.showStates) s.state = host.showStates.shift() ?? s.state;
      return { send: SEND_COLUMNS(s), counts: { queued: 0, submitting: 0, accepted: s.accepted ?? 0, failed: 0, uncertain: 0, suppressed: 0, closed: 0 }, deliveries: [], delivery_claim: "smtp-acceptance-only" };
    }
    if (verb === "sends.prepare") {
      if (host.prepareFails) throw await err("refused", 400, host.prepareFails);
      const send = { send_id: `send-${host.sends.length + 1}`, request_id: args.request_id, state: "prepared", freeze: args.audience_freeze_id, n: host.sends.length + 1 };
      host.sends.push(send);
      return { send: SEND_COLUMNS(send), counts: { included: host.frozen, excluded: 0, suppressed_now: 0, final: host.frozen, max_recipients: host.frozen }, sample: [], send_digest: "x" };
    }
    throw new Error("unexpected call " + verb);
  },
  serviceSlot: async (_scope, verb, args) => {
    host.log.push(verb);
    if (verb === "sends.approve" && host.approve) { const next = host.approve; host.approve = null; await next(args); }
    return {};
  },
}));

let run, store, model, chain, grammar, client, status;
const scope = { installId: "i1", digest: "d" };
const KEY = "i1:c1";
beforeAll(async () => {
  run = await import("../../src/features/crm/campaign/runSendChain.ts");
  store = await import("../../src/features/crm/campaign/sendChainStore.ts");
  model = await import("../../src/features/crm/campaigns/audienceModel.ts");
  chain = await import("../../src/features/crm/campaign/sendChain.ts");
  grammar = await import("../../src/features/crm/campaignGrammar.ts");
  client = await import("../../src/features/crm/sendClient.ts");
  status = await import("../../src/features/crm/campaign/sendStatus.ts");
});
beforeEach(() => {
  store.resetChains();
  Object.assign(host, { shape: "native", frozen: 100, sends: [], log: [], holdList: null, approve: null, showFails: false, listFails: false, prepareFails: null, showStates: null });
});

const pickAll = { base: { mode: "all" }, exclusionListId: null };
const idFor = (n) => model.audienceFreezeId("c1", pickAll, model.sendCeiling(n));
const go = (n, over = {}) => run.runSendChain({
  key: KEY, scope, campaignId: "c1", doc: grammar.parseContentDoc(doc()),
  selection: { base: { mode: "all" }, exclusionListId: null, maxRecipients: model.sendCeiling(n) },
  freezeId: idFor(n), count: n, knownSendIds: new Set(), settlePauseMs: 5, onDoc: () => {}, ...over,
});
const page = (n) => store.publishCurrent(KEY, { freezeId: idFor(n), count: n });

test("the ceiling steps in tens, is part of the freeze address and never exceeds 500", () => {
  expect(model.sendCeiling(100)).toBe(140);
  expect(model.sendCeiling(99)).toBe(140);
  expect(model.sendCeiling(2)).toBe(20);
  expect(model.sendCeiling(393)).toBe(500);
  expect(model.sendCeiling(500)).toBe(500);
  expect(idFor(100)).toBe(idFor(99));
  expect(idFor(100)).not.toBe(idFor(300));
  expect(model.audienceFreezeId("c1", pickAll, null)).toBeNull();
});

test("only one chain runs: a second press, even after a remount, is refused", async () => {
  page(100);
  let release;
  host.holdList = new Promise((r) => { release = r; });
  const first = go(100);
  await new Promise((r) => setTimeout(r, 5));
  expect(store.getChain(KEY).phase).not.toBeNull();
  await go(100); // a remounted page presses again
  host.holdList = null; release();
  await first;
  expect(host.log.filter((v) => v === "sends.prepare").length).toBe(1);
  expect(host.log.filter((v) => v === "sends.approve").length).toBe(1);
  expect(store.getChain(KEY).approvedSendId).toBe("send-1");
});

test("no page, a reopening page or a changed audience stops the chain with the true reason", async () => {
  await go(100);
  expect(store.getChain(KEY).notice.text).toBe("The page was closed while sending was starting.");
  store.publishCurrent(KEY, { freezeId: null, count: null });
  await go(100);
  expect(store.getChain(KEY).notice.text).toBe("The page was reopened while sending was starting.");
  page(100);
  let release;
  host.holdList = new Promise((r) => { release = r; });
  const p = go(100);
  await new Promise((r) => setTimeout(r, 5));
  store.publishCurrent(KEY, { freezeId: idFor(400), count: 400 });
  host.holdList = null; release();
  await p;
  expect(store.getChain(KEY).notice.text).toBe("The audience changed while sending was starting.");
  expect(host.log.includes("sends.approve")).toBe(false);
});

test("a count that moved recounts, prepares fresh next time, and leftover prepared rows never block", async () => {
  page(100);
  host.frozen = 99;
  await go(100);
  let record = store.getChain(KEY);
  expect(record.notice.text).toBe("The number of people changed to {after}. Check it and press Send again.");
  expect(record.notice.slots).toEqual({ after: "99" });
  expect(record.recount).toBeGreaterThan(0);
  store.consumeRecount(KEY);
  expect(store.getChain(KEY).recount).toBe(0);
  expect(host.log.includes("sends.approve")).toBe(false);
  page(99);
  await go(99, { knownSendIds: new Set(["send-1"]) });
  record = store.getChain(KEY);
  expect(record.notice).toBeNull();
  expect(host.sends.length).toBe(2); // the leftover prepared row stays, honestly
  expect(host.sends[0].state).toBe("prepared");
  expect(record.approvedSendId).toBe("send-2");
});

test("any prepare refusal recounts", async () => {
  page(100);
  host.prepareFails = "conflict";
  await go(100);
  expect(store.getChain(KEY).recount).toBeGreaterThan(0);
  expect(store.getChain(KEY).notice.kind).toBe("error");
});

test("an unreadable send list, or a send this page did not know, stops before prepare", async () => {
  page(100);
  host.listFails = true;
  await go(100);
  expect(host.log.includes("sends.prepare")).toBe(false);
  expect(store.getChain(KEY).notice.text).toBe("Couldn't check earlier sends.");
  host.listFails = false;
  host.sends.push({ send_id: "other-tab", request_id: "r", state: "sending", freeze: "f", n: 1 });
  await go(100);
  expect(host.log.includes("sends.prepare")).toBe(false);
  expect(store.getChain(KEY).notice.text).toBe("This campaign was sent from somewhere else. Check Activity before sending again.");
  await go(100, { knownSendIds: new Set(["other-tab"]) }); // the page knows it now
  expect(host.log.includes("sends.approve")).toBe(true);
});

// What a failed confirmation proves: only the host's own card layer words (cancelled, expired,
// superseded, busy) say the confirm did not run. Everything else may have mailed.
test("only the host's card codes prove nothing was sent", async () => {
  for (const code of ["cancelled", "expired", "superseded", "busy"]) expect(chain.isHostLocalRefusal(await err("x", 400, code))).toBe(true);
  for (const [status, code] of [[400, "failed"], [503, "unavailable"], [504, undefined], [502, undefined], [409, "conflict"]]) {
    expect(chain.isHostLocalRefusal(await err("x", status, code))).toBe(false);
  }
});

test("a lost confirm answer is settled by reading the send, never guessed from the code", async () => {
  page(100);
  // the mail went out; the answer was lost as a coded `failed`
  host.approve = async (args) => { host.sends.find((s) => s.send_id === args.send_id).state = "sending"; throw await err("Cadence refused this request.", 400, "failed"); };
  await go(100);
  let record = store.getChain(KEY);
  expect(record.notice).toBeNull();
  expect(record.approvedSendId).toBe("send-1");
  expect(record.pendingSendId).toBeNull();
});

test("the claim race: a prepared read right after a failure is read again before 'nothing was sent'", async () => {
  page(100);
  host.approve = async () => { throw await err("down", 503, "unavailable"); };
  host.showStates = ["prepared", "sending"]; // first read still prepared, then the board claims it
  await go(100);
  expect(store.getChain(KEY).approvedSendId).toBe("send-1");
  expect(store.getChain(KEY).notice).toBeNull();
});

test("a send still prepared after the second read was not confirmed", async () => {
  page(100);
  host.approve = async () => { throw await err("down", 503, "unavailable"); };
  await go(100);
  const record = store.getChain(KEY);
  expect(record.notice).toEqual({ kind: "error", text: "The send wasn't confirmed." });
  expect(record.pendingSendId).toBeNull();
});

test("if the read fails too the result is unknown, Send stays blocked, and Retry settles it", async () => {
  page(100);
  host.approve = async (args) => { host.sends.find((s) => s.send_id === args.send_id).state = "completed"; throw await err("html 500", 502); };
  host.showFails = true;
  await go(100);
  let record = store.getChain(KEY);
  expect(record.notice.kind).toBe("unknown");
  expect(record.pendingSendId).toBe("send-1");
  const before = host.log.filter((v) => v === "sends.prepare").length;
  await go(100); // blocked while pending
  expect(host.log.filter((v) => v === "sends.prepare").length).toBe(before);
  host.showFails = false;
  await run.settleSend(KEY, scope, "send-1", 0);
  record = store.getChain(KEY);
  expect(record.approvedSendId).toBe("send-1");
  expect(record.pendingSendId).toBeNull();
  expect(record.settling).toBe(false);
});

test("a cancelled card is quiet and an expired one says nothing was sent", async () => {
  page(100);
  host.approve = async () => { throw await err("Cancelled.", 400, "cancelled"); };
  await go(100);
  expect(store.getChain(KEY).notice.kind).toBe("cancelled");
  expect(store.getChain(KEY).pendingSendId).toBeNull();
  host.approve = async () => { throw await err("That took too long. Try again.", 400, "expired"); };
  await go(100, { knownSendIds: new Set(["send-1"]) });
  expect(store.getChain(KEY).notice.kind).toBe("error");
  expect(store.getChain(KEY).pendingSendId).toBeNull();
});

test("hosted list rows carry no counts: they read as finished, never as nothing sent", async () => {
  host.shape = "hosted";
  host.sends.push({ send_id: "s9", request_id: "r", state: "completed", freeze: "f", n: 9 });
  const rows = client.parseSendList({ sends: host.sends.map(listRow) });
  expect(rows[0].countsKnown).toBe(false);
  expect(rows[0].created).toBe(9);
  expect(status.sendStatus(rows[0]).label).toBe("Finished");
  host.shape = "native";
  host.sends[0].accepted = 0;
  expect(status.sendStatus(client.parseSendList({ sends: host.sends.map(listRow) })[0]).label).toBe("Nothing sent");
});
