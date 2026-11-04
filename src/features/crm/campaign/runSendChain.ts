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
import { audienceChanged,countChanged,isCancelled,isRefusal,reusablePrepared,type ChainPhase } from "./sendChain";
import { beginChain,getCurrent,patchChain,skipPrepared,skippedPrepared } from "./sendChainStore";

/** The chain stopped itself before a host card: nothing was asked or sent. */
class ChainStop extends Error {
  constructor(message: string, readonly slots?: Record<string, string>) { super(message); }
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
  onDoc: (doc: ContentDoc) => void;
}): Promise<void> {
  const { key, scope, campaignId, selection, freezeId, count } = args;
  if (!beginChain(key)) return;
  let doc = args.doc;
  const at = { step: "approving" as ChainPhase };
  let sendId: string | null = null;
  let reused = false;
  const phase = (next: ChainPhase) => { at.step = next; patchChain(key, { phase: next }); };
  const stillSame = () => {
    const current = getCurrent(key);
    if (current === undefined) throw new ChainStop("The page was closed while sending was starting.");
    if (audienceChanged(freezeId, current.freezeId)) throw new ChainStop("The audience changed while sending was starting.");
  };
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
    // An unapproved prepared send that still matches is confirmed again,
    // not duplicated; the host re-verifies it at approval.
    const earlier = await sendClient.sendList(scope, campaignId).then(parseSendList, () => null);
    const again = reusablePrepared(
      earlier,
      { freezeId, maxRecipients: selection.maxRecipients, contentRevision: doc.revision, contentDigest: doc.contentDigest },
      skippedPrepared(key),
    );
    if (again !== null) {
      sendId = again;
      reused = true;
    } else {
      const prepared = parsePreparedSend(
        await sendClient.sendPrepare(scope, campaignId, freezeId, newAudienceId("send"), selection),
      );
      sendId = prepared.send.sendId;
      if (countChanged(count, prepared.counts.final)) {
        // The count the owner agreed to is out of date: recount, show the new
        // number on the button, and let the next press confirm what was frozen.
        patchChain(key, { recount: Date.now() });
        throw new ChainStop("The number of people changed to {after}. Check it and press Send again.", { after: String(prepared.counts.final) });
      }
    }
    stillSame();
    phase("confirming");
    // From here a host card may be confirmed: remember which send, so the page
    // observes its result rather than offering a second send.
    patchChain(key, { pendingSendId: sendId });
    const view = parseSendView(await sendClient.sendApprove(scope, sendId));
    patchChain(key, { approvedSendId: view.send.sendId, pendingSendId: null });
  } catch (err: unknown) {
    const confirming = at.step === "confirming";
    if (isApprovalRequired(err)) {
      patchChain(key, { notice: { kind: "waiting", text: "", confirming }, pendingSendId: null });
    } else if (isCancelled(err)) {
      patchChain(key, { notice: { kind: "cancelled", text: "", confirming }, pendingSendId: null });
    } else if (err instanceof ChainStop) {
      patchChain(key, { notice: { kind: "error", text: err.message, slots: err.slots, confirming: false }, pendingSendId: null });
    } else {
      // A refusal proves the host did not run the confirmation; a timeout or
      // a malformed answer does not, so that send stays pending and observed.
      const proven = isRefusal(err);
      if (confirming && proven && reused && sendId !== null) skipPrepared(key, sendId);
      patchChain(key, {
        notice: { kind: "error", text: at.step === "approving" ? friendlyCampaignError(err) : friendlySendError(err), confirming: confirming && !proven },
        pendingSendId: confirming && !proven ? sendId : null,
      });
    }
  } finally {
    const record = { phase: null as ChainPhase | null, ended: Date.now() };
    patchChain(key, record);
  }
}
