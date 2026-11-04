import type { ContentDoc } from "../campaignGrammar";
import type { SmtpBinding,TestSendReceipt } from "../sendClient";
import { EMAIL_SENDING_HREF } from "../sendingView";

/**
 * The send prerequisites as data. One list feeds the Review and send
 * rows, the button and the line that says why it is blocked, so they can
 * never disagree. The daemon still re-verifies every input at prepare and
 * approve. Content approval is not a row: pressing send asks the host to
 * approve the current revision as the first step of the send.
 */

export type CampaignTab = "email" | "audience" | "review" | "activity";

/** Where an unmet item is fixed. */
export type FixTarget =
  | { kind: "tab"; tab: CampaignTab; label: string }
  | { kind: "href"; href: string; label: string }
  | { kind: "test"; label: string };

/** What is known about the chosen audience's size. */
export type AudienceState =
  | { state: "unchosen" }
  | { state: "counting" }
  /** The choice is still being written to the board. A send waits for it:
   *  saving after a freeze would make that freeze stale at once. */
  | { state: "saving" }
  | { state: "unsaved" }
  /** A new audience is waiting for unsaved email edits to be saved or discarded. */
  | { state: "email-unsaved" }
  | { state: "error" }
  /** More people than one send can freeze (500): both hosts refuse it. */
  | { state: "too-many"; count: number }
  | { state: "empty"; reason: string | null }
  | { state: "ready"; count: number };

export type TestState = "none" | "not-accepted" | "content-changed" | "sender-changed" | "ok";

export interface ReadinessItem {
  key: "draft" | "audience" | "sender" | "test";
  done: boolean;
  /** Plain-English line saying what is missing; null when done. */
  blocker: string | null;
  fix: FixTarget | null;
}

export interface ReadinessInput {
  doc: ContentDoc | null;
  /** `undefined` = still loading, `null` = none bound. */
  binding: SmtpBinding | null | undefined;
  testEvidence: TestSendReceipt | null;
  audience: AudienceState;
}

/** Whether a test of this exact version and sender is on record. */
export function testState(
  doc: ContentDoc | null,
  binding: SmtpBinding | null | undefined,
  evidence: TestSendReceipt | null,
): TestState {
  if (evidence === null || doc === null || binding === null || binding === undefined) return "none";
  if (evidence.contentRevision !== doc.revision || evidence.contentDigest !== doc.contentDigest) return "content-changed";
  if (evidence.linkDigest !== binding.digest) return "sender-changed";
  return evidence.accepted && !evidence.pendingApproval ? "ok" : "not-accepted";
}

export function sendReadiness(input: ReadinessInput): ReadinessItem[] {
  const { doc, binding, testEvidence, audience } = input;
  const test = testState(doc, binding, testEvidence);
  const audienceBlocker =
    audience.state === "unchosen" ? "Choose an audience first."
    : audience.state === "counting" ? "Counting who can receive this…"
    : audience.state === "saving" ? "Saving your audience choice…"
    : audience.state === "email-unsaved" ? "Save or discard your email changes first."
    : audience.state === "unsaved" ? "Your audience choice wasn't saved. Open Audience and retry."
    : audience.state === "too-many" ? "One send can reach up to 500 people. Choose a smaller audience."
    : audience.state === "error" ? "The audience couldn't be counted. Open Audience and retry."
    : audience.state === "empty" ? (audience.reason ?? "Nobody in this audience can be emailed.")
    : null;
  return [
    {
      key: "draft",
      done: doc !== null,
      blocker: doc === null ? "Write the email first." : null,
      fix: { kind: "tab", tab: "email", label: "Edit" },
    },
    {
      key: "audience",
      done: audience.state === "ready",
      blocker: audienceBlocker,
      fix: { kind: "tab", tab: "audience", label: audience.state === "unchosen" ? "Choose" : "Change" },
    },
    {
      key: "sender",
      done: binding !== undefined && binding !== null && binding.state === "live",
      blocker: binding === undefined ? "Checking the sender…" : binding === null || binding.state !== "live" ? "Connect a sender first." : null,
      fix: { kind: "href", href: EMAIL_SENDING_HREF, label: "Set up sending" },
    },
    {
      key: "test",
      done: test === "ok",
      blocker:
        test === "ok" ? null
        : test === "sender-changed" ? "The sender changed. Send a new test, then send."
        : test === "not-accepted" ? (testEvidence?.pendingApproval ? "Approve the test email in AgenticOS, then send it again." : "The last test wasn't accepted. Send a new test, then send.")
        : test === "content-changed" ? "The email changed since the last test. Send a new test, then send."
        : "Send a test email first.",
      fix: { kind: "test", label: test === "none" ? "Send test" : "Send again" },
    },
  ];
}

/** The first unmet item's line — why the send button is disabled. */
export function firstBlocker(items: ReadinessItem[]): string | null {
  return items.find((item) => !item.done)?.blocker ?? null;
}
