import { useEffect,useRef,useState } from "react";
import { audienceClient,type AudienceScope } from "../audienceClient";
import { friendlyAudienceError } from "../segmentGrammar";
import { parsePreview,type AudiencePreview } from "../segments/Segments";
import type { AudiencePick } from "../campaigns/audienceModel";
import type { Viewer } from "../viewer";

/**
 * The host's exact count for the chosen audience, kept above the tabs so
 * Review and send knows the number without the Audience tab being open.
 * Debounced and generation-guarded: an older answer never paints a newer
 * choice. An unchosen audience (or an empty custom list) is not counted.
 */
export function useAudiencePreview(scope: AudienceScope, viewer: Viewer, pick: AudiencePick) {
  const [state, setState] = useState<{ key: string; preview: AudiencePreview } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const generation = useRef(0);
  const key = JSON.stringify({ base: pick.base, exclusion: pick.exclusionListId });
  const countable = pick.base !== null && !(pick.base.mode === "custom" && pick.base.customerIds.length === 0);
  useEffect(() => {
    const mine = ++generation.current;
    setState(null);
    setError(null);
    if (!viewer.operator || !countable || pick.base === null) {
      setLoading(false);
      return;
    }
    const base = pick.base;
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      audienceClient
        .preview(scope, base, pick.exclusionListId ?? undefined)
        .then((value) => {
          if (controller.signal.aborted || mine !== generation.current) return;
          setState({ key, preview: parsePreview(value) });
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || mine !== generation.current) return;
          setError(friendlyAudienceError(e));
        })
        .finally(() => {
          if (!controller.signal.aborted && mine === generation.current) setLoading(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope.installId, viewer.operator, token]);
  return {
    preview: state?.key === key ? state.preview : null,
    loading,
    error,
    recount: () => setToken((n) => n + 1),
  };
}
