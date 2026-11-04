import { ApiError } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import type { AudienceScope } from "../audienceClient";
import { DRAFT_AUDIENCE_MAX_CUSTOMERS,parseContentDoc,sameAudience,type ContentDoc } from "../campaignGrammar";
import { contentClient,type ContentBlock } from "../contentClient";
import type { AudienceKeeping } from "./AudienceSection";
import type { AudiencePick } from "./audienceModel";

/**
 * Keeps the owner's audience choice with the campaign (AOS-521).
 *
 * Request and outcome stay separate: a choice is "saved" only when the
 * board's own answer carries that audience back. A board that does not
 * report `draft_audience_full` cannot keep one, so nothing is sent to it and
 * the choice lives in memory; a board that refuses the argument with a 400
 * is treated the same. The save resends the saved content unchanged at the
 * observed revision — the board keeps the revision and digest for an
 * audience-only save, so a test already accepted stays accepted.
 */
export function useDraftAudience(
  scope: AudienceScope,
  campaignId: string,
  doc: ContentDoc | null,
  onDoc: (doc: ContentDoc) => void,
  pick: AudiencePick,
  emailDirty: boolean,
): { keeping: AudienceKeeping; retry: () => void } {
  const [phase, setPhase] = useState<"idle" | "saving" | "failed" | "refused">("idle");
  const [token, setToken] = useState(0);
  const refused = useRef(false);
  const base = pick.base;
  const key = JSON.stringify(base);
// Only a row that reports `draft_audience_full` can take the argument:
  // a native host refuses unknown fields outright. A pasted-HTML campaign
  // is never resaved here: a blocks save would convert it and the hosted
  // board refuses `html`, so its audience stays on this screen.
  const htmlMode = doc !== null && doc.mode === "html";
  const supported = doc !== null && doc.draftAudience !== undefined && !htmlMode && !refused.current;
  const keepable = base !== null && !(base.mode === "custom" && (base.customerIds.length < 1 || base.customerIds.length > DRAFT_AUDIENCE_MAX_CUSTOMERS));
  const same = doc !== null && base !== null && sameAudience(base, doc.draftAudience);
  const pending = supported && keepable && !same && !emailDirty;

  useEffect(() => {
    if (!pending || doc === null || base === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPhase("saving");
      const common = {
        campaignId,
        subject: doc.subject,
        preheader: doc.preheader,
        expectedRevision: doc.revision,
        draftAudience: base,
        ...(doc.textOverride !== null ? { text: doc.textOverride } : {}),
      };
      void contentClient
        .save(scope, { ...common, blocks: doc.blocks as ContentBlock[] })
        .then((value) => {
          if (controller.signal.aborted) return;
          const next = parseContentDoc(value);
          if (next.draftAudience === undefined) refused.current = true;
          onDoc(next);
          setPhase("idle");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (error instanceof ApiError && error.status === 400) {
            // An older board refuses the argument and changes nothing.
            refused.current = true;
            setPhase("refused");
            return;
          }
          setPhase("failed");
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
  else if (doc === null || !supported || refused.current) keeping = "memory";
  else if (same) keeping = "saved";
  else if (emailDirty) keeping = "waiting";
  else if (phase === "failed") keeping = "failed";
  else keeping = "saving";
  if (!keepable && !same) keeping = "memory";
  return { keeping, retry: () => { setPhase("idle"); setToken((n) => n + 1); } };
}
