import { useEffect,useState } from "react";
import type { AudienceScope } from "../audienceClient";
import { blocksToGrammar,draftFromDoc } from "../campaign/useEmailDraft";
import { DRAFT_AUDIENCE_MAX_CUSTOMERS,parseContentDoc,sameAudience,type ContentDoc } from "../campaignGrammar";
import { contentClient } from "../contentClient";
import type { AudienceKeeping } from "./AudienceSection";
import type { AudiencePick } from "./audienceModel";

/**
 * Keeps the owner's audience choice with the campaign (AOS-521).
 *
 * Request and outcome stay separate: a choice is "saved" only when the
 * board's own answer carries that same audience back. Only a row that
 * reports `draft_audience_full` is sent the argument — a native host refuses
 * unknown fields outright — and a pasted-HTML campaign is never resaved here
 * (a blocks save would convert it, and the hosted board refuses `html`), so
 * those keep the choice on this screen. The save resends the saved blocks
 * through the editor's own projection, unchanged, at the observed revision;
 * the board keeps the revision and digest for an audience-only save, so an
 * accepted test stays accepted. It runs before any prepare, never during one.
 */
export function useDraftAudience(
  scope: AudienceScope,
  campaignId: string,
  doc: ContentDoc | null,
  onDoc: (doc: ContentDoc) => void,
  pick: AudiencePick,
  emailDirty: boolean,
  /** The owner is still typing a list of ids: save once they stop. */
  typing: boolean,
): { keeping: AudienceKeeping; retry: () => void } {
  // A save that was refused or answered with a different audience is not
  // retried by itself for the same choice: that would loop.
  const [outcome, setOutcome] = useState<{ key: string; kind: "failed" | "mismatch" } | null>(null);
  const [token, setToken] = useState(0);
  const base = pick.base;
  const key = JSON.stringify(base);
  const htmlMode = doc !== null && doc.mode === "html";
  const supported = doc !== null && doc.draftAudience !== undefined && !htmlMode;
  const keepable = base !== null && !(base.mode === "custom" && (base.customerIds.length < 1 || base.customerIds.length > DRAFT_AUDIENCE_MAX_CUSTOMERS));
  const same = doc !== null && base !== null && sameAudience(base, doc.draftAudience);
  const settled = outcome?.key === key ? outcome.kind : null;
  const pending = supported && keepable && !same && !emailDirty && !typing && settled === null;

  useEffect(() => {
    if (!pending || doc === null || base === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void contentClient
        .save(scope, {
          campaignId,
          subject: doc.subject,
          preheader: doc.preheader,
          expectedRevision: doc.revision,
          draftAudience: base,
          blocks: blocksToGrammar(draftFromDoc(doc).blocks),
          ...(doc.textOverride !== null ? { text: doc.textOverride } : {}),
        })
        .then((value) => {
          if (controller.signal.aborted) return;
          const next = parseContentDoc(value);
          onDoc(next);
          if (!sameAudience(base, next.draftAudience)) setOutcome({ key, kind: "mismatch" });
        })
        .catch(() => {
          if (!controller.signal.aborted) setOutcome({ key, kind: "failed" });
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, key, doc?.revision, doc?.contentDigest, token]);

  let keeping: AudienceKeeping;
  if (htmlMode) keeping = "html";
  else if (doc === null || !supported || !keepable) keeping = same ? "saved" : "memory";
  else if (same) keeping = "saved";
  else if (settled !== null) keeping = settled;
  else if (emailDirty) keeping = "waiting";
  else if (typing) keeping = "typing";
  else keeping = "saving";
  return { keeping, retry: () => { setOutcome(null); setToken((n) => n + 1); } };
}
