import type { ContentDoc } from "../campaignGrammar";
import type { SmtpBinding,TestSendReceipt } from "../sendClient";
import { EMAIL_SENDING_HREF } from "../sendingView";

/**
 * The send prerequisites as data (CAD-1055). One list feeds both the
 * Overview "Ready to send" checklist and the Final send panel's gate,
 * so the two can never disagree. `reason` is the long-standing
 * "Prepare stays unavailable — missing" sentence; the daemon still
 * re-verifies every input at prepare and approve. Content approval is
 * not a row: prepare approves the current revision as part of the send
 * confirmation, so the campaign has no separate approval step.
 */

export type CampaignTab = "overview" | "email" | "audience" | "activity";

/** Where an unmet item is fixed: another tab, or a panel on Overview. */
export type FixTarget =
  | { kind: "tab"; tab: CampaignTab; label: string }
  | { kind: "anchor"; id: string; label: string }
  | { kind: "href"; href: string; label: string };

export interface ReadinessItem {
  key: "draft" | "freeze" | "sender" | "test";
  /** Plain-language checklist line. */
  label: string;
  done: boolean;
  /** Why it is unmet; null for the draft row (not a prepare gate). */
  reason: string | null;
  fix: FixTarget | null;
  /** False for checks shown in the send confirmation instead of the checklist. */
  checklist: boolean;
}

export interface ReadinessInput {
  doc: ContentDoc | null;
  /** `undefined` = still loading, `null` = none bound. */
  binding: SmtpBinding | null | undefined;
  testEvidence: TestSendReceipt | null;
  /** CAD-1836: the send freezes its own audience, so a counted selection
   *  satisfies the freeze gate before any snapshot exists. */
  selectionReady: boolean;
}

export const TEST_ANCHOR = "cmp-test-section";

export function sendReadiness(input: ReadinessInput): ReadinessItem[] {
  const { doc, binding, testEvidence, selectionReady } = input;

  let senderReason: string | null = null;
  if (binding === undefined) senderReason = "the sender binding read (still loading)";
  else if (binding === null || binding.state !== "live") senderReason = "a live SMTP sender binding";

  let testReason: string | null = null;
  if (testEvidence === null) testReason = "an accepted test send of this content and binding";
  else if (
    doc !== null &&
    binding !== null &&
    binding !== undefined &&
    (testEvidence.contentRevision !== doc.revision ||
      testEvidence.contentDigest !== doc.contentDigest ||
      testEvidence.linkDigest !== binding.digest)
  ) {
    testReason = "a test send accepted against this exact content revision and binding";
  }

  return [
    {
      key: "draft",
      label: "Email drafted",
      done: doc !== null,
      reason: null,
      fix: { kind: "tab", tab: "email", label: "Review" },
      checklist: true,
    },
    {
      key: "freeze",
      label: "Audience ready to freeze with the send",
      done: selectionReady,
      reason: selectionReady ? null : "an audience selection for the send to freeze",
      // The freeze action lives in the send panel, immediately before the
      // send it belongs to; the Audience tab only counts the audience.
      fix: { kind: "anchor", id: "cmp-final-send", label: "Fix" },
      checklist: false,
    },
    {
      key: "sender",
      label: "Email sender connected",
      done: senderReason === null,
      reason: senderReason,
      fix: { kind: "href", href: EMAIL_SENDING_HREF, label: "Set up sending" },
      checklist: true,
    },
    {
      key: "test",
      label: "Test email accepted",
      done: testReason === null,
      reason: testReason,
      fix: { kind: "anchor", id: TEST_ANCHOR, label: "Send a test" },
      checklist: true,
    },
  ];
}

/** The unmet prepare gates, in checklist order. */
export function missingReasons(items: ReadinessItem[]): string[] {
  return items.flatMap((item) => (!item.done && item.reason !== null ? [item.reason] : []));
}
