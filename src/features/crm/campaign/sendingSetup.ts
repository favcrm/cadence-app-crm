import { useCallback, useState } from "react";
import { useScope } from "../../../bridge/scope";
import { friendlySendError, sendClient } from "../sendClient";

/**
 * The host advertises its sender-settings slot only on mounts that can
 * actually open it. Reading the existing reactive scope projection keeps
 * the campaign UI honest: no setup action is rendered as active when the
 * operation is absent, and a failed advertised action reports its error
 * instead of silently doing nothing.
 */
export function useSendingSetup() {
  const snapshot = useScope();
  const scope = snapshot?.scope ?? null;
  const available = snapshot?.actions.includes("smtp.manage") ?? false;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(() => {
    if (scope === null || !available || pending) return;
    setPending(true);
    setError(null);
    void sendClient
      .smtpManage(scope)
      .catch((failure: unknown) => setError(friendlySendError(failure)))
      .finally(() => setPending(false));
  }, [scope, available, pending]);
  return { available, pending, error, open };
}
