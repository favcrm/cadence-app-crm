// CRM-16 send chain: the store that outlives the page, the prepared-send reuse
// and the count-mismatch retry, run against a fake host behind the bridge.
// Run: bun test tests/unit/send_chain.test.mjs
import { test, expect, beforeAll, beforeEach, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

// A fake host. Same freeze address + same membership + different ceiling is
// refused (`ceiling_differs`), as the board and native both do.
const host = { holdCall: null, count: 100, frozen: 100, freezes: new Map(), sends: [], log: [], hold: null, refuse: null, revision: 2 };
const doc = () => ({ content: { campaign_id: "c1", revision: host.revision, subject: "s", preheader: "", blocks: [{ type: "paragraph", text: "x" }], content_digest: "d", approval: { revision: host.revision, digest: "d", valid: true, scope: "content-only" } } });
mock.module("../../src/bridge/services.ts", () => ({
  serviceCall: async (_scope, verb, args) => {
    host.log.push(verb);
    if (verb === "content.show") return doc();
    if (verb === "sends.list") { if (host.holdCall) await host.holdCall; }
    if (verb === "sends.list") return { sends: host.sends.map((s) => ({ ...s })) };
    if (verb === "sends.show") { const s = host.sends.find((x) => x.send_id === args.send_id); return { send: s, counts: s.counts ?? {}, deliveries: [] }; }
    if (verb === "sends.prepare") {
      const prior = host.freezes.get(args.audience_freeze_id);
      if (prior && prior.final === host.frozen && prior.max !== args.max_recipients) { const { ApiError } = await import("@cadence/screen-ui"); throw new ApiError("The send could not be prepared.", 400, { code: "ceiling_differs" }); }
      host.freezes.set(args.audience_freeze_id, { final: host.frozen, max: args.max_recipients });
      const send = { send_id: `send-${host.sends.length + 1}`, campaign_id: "c1", state: "prepared", send_digest: "x", audience_freeze_id: args.audience_freeze_id, max_recipients: args.max_recipients, content_revision: host.revision, content_digest: "d", created: host.sends.length + 1, counts: {} };
      host.sends.push(send);
      return { send, counts: { final: host.frozen }, sample: [], send_digest: "x" };
    }
    throw new Error("unexpected call " + verb);
  },
  serviceSlot: async (_scope, verb, args) => {
    host.log.push(verb);
    if (host.hold) await host.hold;
    if (host.refuse) { const { ApiError } = await import("@cadence/screen-ui"); const code = host.refuse; host.refuse = null; throw new ApiError("refused", 400, { code }); }
    if (verb === "sends.approve") { const s = host.sends.find((x) => x.send_id === args.send_id); s.state = "sending"; }
    return {};
  },
}));

let run, store, model, chain, grammar;
const scope = { installId: "i1", digest: "d" };
beforeAll(async () => {
  run = await import("../../src/features/crm/campaign/runSendChain.ts");
  store = await import("../../src/features/crm/campaign/sendChainStore.ts");
  model = await import("../../src/features/crm/campaigns/audienceModel.ts");
  chain = await import("../../src/features/crm/campaign/sendChain.ts");
  grammar = await import("../../src/features/crm/campaignGrammar.ts");
});
beforeEach(() => {
  store.resetChains();
  Object.assign(host, { holdCall: null, count: 100, frozen: 100, sends: [], log: [], hold: null, refuse: null, revision: 2 });
  host.freezes.clear();
});

const KEY = "i1:c1";
const base = (freezeId, count, over = {}) => {
  const selection = { base: { mode: "all" }, exclusionListId: null, maxRecipients: model.sendCeiling(count ?? 0) };
  return { key: KEY, scope, campaignId: "c1", doc: grammar.parseContentDoc(doc()).campaignId ? grammar.parseContentDoc(doc()) : null, selection, freezeId, count, onDoc: () => {}, ...over };
};
const pickAll = { base: { mode: "all" }, exclusionListId: null };

test("the ceiling is part of the freeze address and steps in tens", () => {
  expect(model.sendCeiling(100)).toBe(140);
  expect(model.sendCeiling(99)).toBe(140);
  expect(model.sendCeiling(2)).toBe(20);
  const a = model.audienceFreezeId("c1", pickAll, model.sendCeiling(100));
  const b = model.audienceFreezeId("c1", pickAll, model.sendCeiling(99));
  const c = model.audienceFreezeId("c1", pickAll, model.sendCeiling(500));
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(model.audienceFreezeId("c1", pickAll, null)).toBeNull();
});

test("only one chain runs: a second press, even after a remount, is refused", async () => {
  const id = model.audienceFreezeId("c1", pickAll, model.sendCeiling(100));
  store.publishCurrent(KEY, { freezeId: id, count: 100 });
  let release;
  host.hold = new Promise((r) => { release = r; });
  const first = run.runSendChain(base(id, 100));
  await Promise.resolve(); await new Promise((r) => setTimeout(r, 5));
  expect(store.getChain(KEY).phase).not.toBeNull();
  await run.runSendChain(base(id, 100)); // a remounted page presses again
  expect(host.log.filter((v) => v === "sends.prepare").length).toBeLessThanOrEqual(1);
  host.hold = null; release();
  await first;
  expect(host.log.filter((v) => v === "sends.approve").length).toBe(1);
  expect(store.getChain(KEY).approvedSendId).toBe("send-1");
  expect(store.getChain(KEY).phase).toBeNull();
});

test("a changed audience, or no page at all, stops the chain before a host card", async () => {
  const id = model.audienceFreezeId("c1", pickAll, model.sendCeiling(100));
  // no page mounted
  await run.runSendChain(base(id, 100));
  expect(host.log).toEqual([]);
  expect(store.getChain(KEY).notice.text).toBe("The page was closed while sending was starting.");
  // audience changed between the press and the card
  store.publishCurrent(KEY, { freezeId: id, count: 100 });
  let release;
  host.holdCall = new Promise((r) => { release = r; });
  const p = run.runSendChain(base(id, 100));
  await new Promise((r) => setTimeout(r, 5));
  store.publishCurrent(KEY, { freezeId: "other", count: 100 });
  host.holdCall = null; release();
  await p;
  expect(host.log.includes("sends.approve")).toBe(false);
  expect(store.getChain(KEY).notice.text).toBe("The audience changed while sending was starting.");
  expect(store.getChain(KEY).phase).toBeNull();
});

test("a count that moved between count and press recounts, and the next press confirms what was frozen", async () => {
  const id = model.audienceFreezeId("c1", pickAll, model.sendCeiling(100));
  store.publishCurrent(KEY, { freezeId: id, count: 100 });
  host.frozen = 99; // one opt-out between the count and the press
  await run.runSendChain(base(id, 100));
  let record = store.getChain(KEY);
  expect(record.notice.text).toBe("The number of people changed to {after}. Check it and press Send again.");
  expect(record.notice.slots).toEqual({ after: "99" });
  expect(record.recount).toBeGreaterThan(0);
  expect(host.log.includes("sends.approve")).toBe(false);
  expect(host.sends.length).toBe(1);
  // the page recounted to 99: same ceiling, same freeze, same prepared send
  const id2 = model.audienceFreezeId("c1", pickAll, model.sendCeiling(99));
  expect(id2).toBe(id);
  store.publishCurrent(KEY, { freezeId: id2, count: 99 });
  await run.runSendChain(base(id2, 99));
  record = store.getChain(KEY);
  expect(record.notice).toBeNull();
  expect(host.sends.length).toBe(1); // reused, no extra prepared row
  expect(host.log.filter((v) => v === "sends.prepare").length).toBe(1);
  expect(host.log.filter((v) => v === "sends.approve").length).toBe(1);
  expect(record.approvedSendId).toBe("send-1");
});

test("a count that moves the ceiling goes to a new freeze, never to ceiling_differs", async () => {
  const idA = model.audienceFreezeId("c1", pickAll, model.sendCeiling(100));
  store.publishCurrent(KEY, { freezeId: idA, count: 100 });
  await run.runSendChain(base(idA, 100));
  // the audience grows to 300 before the next press
  host.frozen = 300;
  const idB = model.audienceFreezeId("c1", pickAll, model.sendCeiling(300));
  expect(idB).not.toBe(idA);
  store.publishCurrent(KEY, { freezeId: idB, count: 300 });
  await run.runSendChain(base(idB, 300));
  expect(store.getChain(KEY).notice).toBeNull();
  expect(store.getChain(KEY).approvedSendId).not.toBeNull();
});

test("a cancelled card is quiet; a refused reused send is not offered again", async () => {
  const id = model.audienceFreezeId("c1", pickAll, model.sendCeiling(100));
  store.publishCurrent(KEY, { freezeId: id, count: 100 });
  host.refuse = "cancelled";
  await run.runSendChain(base(id, 100)); // refuses the content card or the send card
  expect(store.getChain(KEY).notice.kind).toBe("cancelled");
  expect(store.getChain(KEY).pendingSendId).toBeNull();
  // a prepared row now exists only if the cancel hit the send card
  host.refuse = null;
  host.sends = [];
  await run.runSendChain(base(id, 100));
  host.sends[0].state = "prepared"; // pretend it was never approved
  host.refuse = "stale_send";
  await run.runSendChain(base(id, 100)); // reuses it; the host refuses it
  expect(store.getChain(KEY).notice.kind).toBe("error");
  const before = host.sends.length;
  await run.runSendChain(base(id, 100)); // must prepare fresh, not loop on the refused row
  expect(host.sends.length).toBe(before + 1);
});

test("an answer that proves nothing keeps the send pending and observed", async () => {
  const id = model.audienceFreezeId("c1", pickAll, model.sendCeiling(100));
  store.publishCurrent(KEY, { freezeId: id, count: 100 });
  const { ApiError } = await import("@cadence/screen-ui");
  expect(chain.isRefusal(new ApiError("x", 400, { code: "failed" }))).toBe(true);
  expect(chain.isRefusal(new ApiError("timeout", 504))).toBe(false);
  host.hold = Promise.reject(new ApiError("CRM request did not answer.", 504));
  host.hold.catch(() => {});
  await run.runSendChain(base(id, 100));
  const record = store.getChain(KEY);
  // the first card (content approve is skipped: already approved) is prepare then approve
  expect(record.notice.kind).toBe("error");
  expect(record.pendingSendId).not.toBeNull();
  expect(record.notice.confirming).toBe(true);
});

test("reusablePrepared only matches an unchanged, unrefused prepared send", () => {
  const row = { sendId: "s1", state: "prepared", audienceFreezeId: "f", maxRecipients: 140, contentRevision: 2, contentDigest: "d" };
  const want = { freezeId: "f", maxRecipients: 140, contentRevision: 2, contentDigest: "d" };
  expect(chain.reusablePrepared([row], want, new Set())).toBe("s1");
  expect(chain.reusablePrepared([row], { ...want, maxRecipients: 150 }, new Set())).toBeNull();
  expect(chain.reusablePrepared([row], { ...want, contentRevision: 3 }, new Set())).toBeNull();
  expect(chain.reusablePrepared([{ ...row, state: "sending" }], want, new Set())).toBeNull();
  expect(chain.reusablePrepared([row], want, new Set(["s1"]))).toBeNull();
  expect(chain.reusablePrepared(null, want, new Set())).toBeNull();
});
