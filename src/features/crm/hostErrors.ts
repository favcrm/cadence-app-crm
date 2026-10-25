import { ApiError } from "@cadence/screen-ui";

/**
 * The one error-to-message layer every CRM list shares (CAD-1009).
 * A hosted session that expired answers a records fetch with a 401 and
 * a cross-origin redirect to the authorize URL, which `fetch` cannot
 * follow: it throws a bare TypeError (or a non-Error object). Those all
 * read as one human sentence, and the notice offers a reload — a
 * top-level navigation re-authenticates. A message is always a string:
 * an object is never stringified.
 */
export const SESSION_EXPIRED_TEXT =
  "Your session expired or the connection dropped — reload the page to sign in again.";

/** A board effect the owner has to approve. This is a designed waiting
 *  state, not a failure: nothing changed, nothing should be retried, and
 *  the request is already sitting in the owner's approvals inbox. */
export const APPROVAL_REQUIRED_TEXT =
  "Waiting for the owner's approval — nothing has changed yet.";

/** The daemon's bare "app <x> management refused or unavailable" line
 *  carries no reason: it is dropped, never shown glued to a message. */
const GENERIC_REFUSAL = /^app [a-z ]+? refused or unavailable[\s:.\u2014-]*/i;

export function isGenericRefusal(error: unknown): boolean {
  return error instanceof ApiError && GENERIC_REFUSAL.test(error.message);
}

/** The board's typed approval gate, never a retryable failure. */
export function isApprovalRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === "approval_required";
}

export function hostErrorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return SESSION_EXPIRED_TEXT;
    const message = error.message.replace(GENERIC_REFUSAL, "").trim();
    return message === "" || message.startsWith("[object ") ? fallback : message;
  }
  if (error instanceof TypeError) return SESSION_EXPIRED_TEXT;
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message !== "") return message;
    // A bare object thrown by fetch (an opaque redirect) is a transport failure.
    return SESSION_EXPIRED_TEXT;
  }
  return fallback;
}
