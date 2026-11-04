import { friendlyCampaignError,parseContentDoc,type ContentDoc } from "../campaignGrammar";
import { contentClient } from "../contentClient";
import { isApprovalRequired } from "../hostErrors";
import { newAudienceId } from "../segmentGrammar";
import {
friendlySendError,
parsePreparedSend,
parseSendList,
parseSendView,
sendClient,
type SendSelection
} from "../sendClient";
import type { AudienceScope } from "../audienceClient";
import { audienceChanged,countChanged,isCancelled,isHostLocalRefusal,type ChainPhase } from "./sendChain";
import { beginChain,getChain,getCurrent,patchChain } from "./sendChainStore";

/** The chain stopped itself before a host card: nothing was asked or sent. */
class ChainStop extends Error {
  constructor(message: string, readonly slots?: Record<string, string>) { super(message); }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * After a failed confirmation, find out what happened instead of guessing.
 * Hosted sends the mail inside the confirm request, so a lost answer can hide
 * a send that went out. A `prepared` read right after a failure is not proof
 * (the board may be about to claim it), so it is read again after a pause;
 * only a send still `prepared` after that is called not sent. A read that
 * fails leaves the result unknown, Send blocked, and Retry on the page.
 */
export async function settleSend(key: string, scope: AudienceScope, sendId: string, pauseMs = 1500): Promise<void> {
  patchChain(key, { settling: true });
  try {
    let view = parseSendView(await sendClient.sendShow(scope, sendId));
    if (view.send.state === "prepared") {
      await sleep(pauseMs);
      view = parseSendView(await sendClient.sendShow(scope, sendId));
    }
    if (view.send.state === "prepared") {
      patchChain(key, { pendingSendId: null, notice: { kind: "error", text: "The send wasn't confirmed." } });
    } else {
      // It went out (or is going out): show its result, never Draft.
      patchChain(key, { approvedSendId: sendId, pendingSendId: null, notice: null });
    }
  } catch {
    patchChain(key, { notice: { kind: "unknown", text: "We couldn't confirm whether this send went out." } });
  } finally {
    patchChain(key, { settling: false, ended: Date.now() });
  }
}

/**
 * One press of Send. Runs outside any React component so a remount cannot
 * lose it: its lock, phase and outcome live in the chain store. The audience
 * on screen is read from the store at each step, never from a closure, so a
 * changed audience (or no page at all) stops it before the next host card.
 */
export async function runSendChain(args: {
  key: string;
  scope: AudienceScope;
  campaignId: string;
  doc: ContentDoc;
  selection: SendSelection;
  freezeId: string;
  count: number | null;
  /** The sends the page knew about when Send was pressed. */
  knownSendIds: ReadonlySet<string>;
  /** Pause before the second read after a failed confirmation (tests shorten it). */
  settlePauseMs?: number;
  onDoc: (doc: ContentDoc) => void;
}): Promise<void> {
  const { key, scope, campaignId, selection, freezeId, count } = args;
  if (getChain(key).pendingSendId !== null || !beginChain(key)) return;
  let doc = args.doc;
  const at = { step: "approving" as ChainPhase };
  let sendId: string | null = null;
  const phase = (next: ChainPhase) => { at.step = next; patchChain(key, { phase: next }); };
  const stillSame = () => {
    const current = getCurrent(key);
    if (current === undefined) throw new ChainStop("The page was closed while sending was starting.");
    // Not counted yet: the page was reopened and is counting again.
    if (current.freezeId === null) throw new ChainStop("The page was reopened while sending was starting.");
    if (audienceChanged(freezeId, current.freezeId)) throw new ChainStop("The audience changed while sending was starting.");
  };
  let settle = false;
  try {
    stillSame();
    // The daemon requires the current revision to be approved before it
    // prepares; the host's content card is that approval.
    if (!(doc.approval.valid && doc.approval.revision === doc.revision)) {
      doc = parseContentDoc(await contentClient.approve(scope, campaignId, doc.revision));
      args.onDoc(doc);
    }
    phase("preparing");
    stillSame();
    // Another tab (or an earlier visit) may have sent this campaign since the
    // page last read the list. If the list cannot be read, or shows a send
    // this page did not know, stop and refresh rather than send twice.
    const earlier = await sendClient.sendList(scope, campaignId).then(parseSendList, () => null);
    if (earlier === null) throw new ChainStop("Couldn't check earlier sends.");
    if (earlier.some((row) => row.state !== "prepared" && !args.knownSendIds.has(row.sendId))) {
      patchChain(key, { ended: Date.now() });
      throw new ChainStop("This campaign was sent from somewhere else. Check Activity before sending again.");
    }
    let prepared;
    try {
      prepared = parsePreparedSend(
        await sendClient.sendPrepare(scope, campaignId, freezeId, newAudienceId("send"), selection),
      );
    } catch (error) {
      // Any refusal may mean the audience moved under the button: recount.
      patchChain(key, { recount: Date.now() });
      throw error;
    }
    sendId = prepared.send.sendId;
    if (countChanged(count, prepared.counts.final)) {
      // The count the owner agreed to is out of date: recount, show the new
      // number on the button, and prepare fresh on the next press.
      patchChain(key, { recount: Date.now() });
      throw new ChainStop("The number of people changed to {after}. Check it and press Send again.", { after: String(prepared.counts.final) });
    }
    stillSame();
    phase("confirming");
    // From here a host card may be confirmed: remember which send, so the page
    // observes its result rather than offering a second send.
    patchChain(key, { pendingSendId: sendId });
    await sendClient.sendApprove(scope, sendId);
    // The confirmation resolved: it is approved, whatever a later read says.
    patchChain(key, { approvedSendId: sendId, pendingSendId: null });
  } catch (err: unknown) {
    const confirming = at.step === "confirming";
    if (isApprovalRequired(err)) {
      patchChain(key, { notice: { kind: "waiting", text: "" }, pendingSendId: null });
    } else if (isCancelled(err)) {
      patchChain(key, { notice: { kind: "cancelled", text: "" }, pendingSendId: null });
    } else if (err instanceof ChainStop) {
      patchChain(key, { notice: { kind: "error", text: err.message, slots: err.slots }, pendingSendId: null });
    } else if (confirming && !isHostLocalRefusal(err)) {
      // Not something the host's card layer says about a closed card: the
      // confirm may have run. Do not infer from the code; read the send.
      settle = true;
    } else {
      patchChain(key, {
        notice: { kind: "error", text: at.step === "approving" ? friendlyCampaignError(err) : friendlySendError(err) },
        pendingSendId: null,
      });
    }
  } finally {
    patchChain(key, { phase: null, ended: Date.now() });
  }
  if (settle && sendId !== null) await settleSend(key, scope, sendId, args.settlePauseMs);
}
