import { useLocale } from "../locale";
import { ApiError, Button, Field, Select } from "@cadence/screen-ui";
import { useEffect, useRef, useState } from "react";
import {
  ASSIGNEE_MAX,
  BLOCKED_REASON_MAX,
  DUE_AT_LENGTH,
  WORK_STATUSES,
  nextDecision,
  parseWorkView,
  readinessFacts,
  workPatch,
  workRevision,
  type CampaignWorkFacts,
  type WorkRecord,
  type WorkWritePatch,
} from "../../../domain/campaignWork";
import { getScope } from "../../../bridge/scope";
import { campaignWorkClient, type WorkScope, type WorkWriteInput } from "../campaignWorkClient";
import type { ReadinessItem } from "../campaign/readiness";

/**
 * Campaign work: who owns the campaign, when it is due, what lifecycle it
 * reached and the app-computed next decision (CRM-12).
 *
 * Nothing is inferred. A campaign with no recorded work shows "Unassigned"
 * and "not set" values; a host that does not advertise the operations shows
 * an explicit unavailable note instead of a form. Any other read failure
 * (transport, 503, malformed reply) is its own alert with a retry, for
 * writable and read-only viewers alike. The next decision comes from the
 * same readiness chain the Overview checklist renders, so the two can never
 * disagree.
 *
 * A save carries the revision the panel read. A stale revision saves
 * nothing, re-reads the current row and keeps the operator's edits on
 * screen with a persistent conflict notice — never a silent overwrite and
 * never a silent retry.
 */
export default function CampaignWorkPanel({
  scope,
  campaignId,
  canWrite,
  readiness,
}: {
  scope: WorkScope;
  campaignId: string;
  canWrite: boolean;
  readiness: readonly ReadinessItem[];
}) {
  const { t, formatDate, formatNumber } = useLocale();
  const [view, setView] = useState<CampaignWorkFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** A read failure that is not "no metadata": transport, 5xx or a reply the
   *  contract refuses. Shown to every viewer and never replaced by a guess. */
  const [unreadable, setUnreadable] = useState<string | null>(null);
  /** Why the panel cannot read: the host lacks the operations, the caller is
   *  forbidden, or the campaign has no source row. */
  const [blocked, setBlocked] = useState<"host" | "forbidden" | null>(null);
  /** Set after a stale refusal; `revision: null` while the re-read runs. */
  const [conflict, setConflict] = useState<{ revision: number | null } | null>(null);
  const [assignee, setAssignee] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [status, setStatus] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const generation = useRef(0);

  const seed = (work: WorkRecord | null) => {
    setAssignee(work?.assignee ?? "");
    setDueAt(work?.dueAt ?? "");
    setStatus(work?.status ?? "");
    setBlockedReason(work?.blockedReason ?? "");
  };

  const fail = (reason: unknown) => {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      setBlocked(getScope()?.actions.includes("campaign-work.show") === true ? "forbidden" : "host");
      return;
    }
    setUnreadable(reason instanceof ApiError ? reason.message : "Couldn't read the campaign work details.");
  };

  const load = () => {
    const current = ++generation.current;
    setLoading(true);
    setBlocked(null);
    setUnreadable(null);
    setSaveError(null);
    setConflict(null);
    campaignWorkClient.show(scope, campaignId).then((raw) => {
      if (current !== generation.current) return;
      const facts = parseWorkView(raw);
      setView(facts);
      seed(facts.work);
    }).catch((reason: unknown) => {
      if (current !== generation.current) return;
      setView(null);
      fail(reason);
    }).finally(() => {
      if (current === generation.current) setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.installId, campaignId]);

  /** After a stale refusal: re-read the current row *without* touching the
   *  operator's typed values, so the conflict notice can be reviewed against
   *  the values that actually won. */
  const reread = () => {
    const current = ++generation.current;
    campaignWorkClient.show(scope, campaignId).then((raw) => {
      if (current !== generation.current) return;
      const facts = parseWorkView(raw);
      setView(facts);
      setUnreadable(null);
      setConflict({ revision: workRevision(facts.work) });
    }).catch((reason: unknown) => {
      if (current !== generation.current) return;
      fail(reason);
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || view === null || saving) return;
    setSaveError(null);
    let request: Promise<unknown>;
    try {
      const patch: WorkWritePatch = workPatch(view.work, { assignee, dueAt, status, blockedReason });
      if (Object.keys(patch).length === 0) throw new ApiError("Change at least one work detail before saving.", 400);
      const input: WorkWriteInput = { campaignId, expectedRevision: workRevision(view.work), ...patch };
      // Grammar, scope and value refusals are synchronous. Build the request
      // before the busy state so a refused value leaves the controls usable
      // and shows its message instead of disabling the form.
      request = campaignWorkClient.save(scope, input);
    } catch (reason) {
      setSaveError(reason instanceof ApiError ? reason.message : "That work detail is not valid.");
      return;
    }
    setSaving(true);
    request.then((raw) => {
      const facts = parseWorkView(raw);
      setView(facts);
      seed(facts.work);
      setConflict(null);
    }).catch((reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 409) {
        setConflict({ revision: null });
        reread();
        return;
      }
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        fail(reason);
        return;
      }
      setSaveError(reason instanceof ApiError ? reason.message : "Couldn't save the campaign work details.");
    }).finally(() => setSaving(false));
  };

  const work = view?.work ?? null;
  const decision = nextDecision(work, readinessFacts(readiness));
  const statusOptions = [
    { value: "", label: t("Not set") },
    ...WORK_STATUSES.map((row) => ({ value: row.value, label: t(row.label) })),
  ];
  const dirty = view !== null && (
    assignee.trim() !== (work?.assignee ?? "") ||
    dueAt.trim() !== (work?.dueAt ?? "") ||
    status !== (work?.status ?? "") ||
    (status === "blocked" && blockedReason.trim() !== (work?.blockedReason ?? ""))
  );

  return (
    <section className="card px-4 py-3 grid gap-2" aria-label={t("Campaign work")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-label font-medium text-ink-100">{t("Work")}</h4>
        {work !== null && (
          <span className="text-label text-ink-400">
            {t("Revision")} {formatNumber(work.revision)} · {t("content")} {work.contentRevision === null ? t("none") : formatNumber(work.contentRevision)}
          </span>
        )}
      </div>
      {loading && <p className="text-label text-ink-400" role="status">{t("Reading the campaign work…")}</p>}
      {!loading && blocked !== null && (
        <p className="text-label text-ink-400" role="status">
          {blocked === "host"
            ? t("Campaign work isn't available on this host.")
            : t("You don't have access to this campaign's work details.")}
        </p>
      )}
      {!loading && blocked === null && unreadable !== null && (
        <p className="text-label text-fail" role="alert">
          {t(unreadable)}{" "}
          <button type="button" className="lnk" onClick={load}>{t("Retry")}</button>
        </p>
      )}
      {!loading && blocked === null && view !== null && (
        <>
          <p className="text-label">
            {work?.assignee ?? t("Unassigned")} · {work?.dueAt ?? t("No due date")} · {work?.status == null ? t("Status not set") : t(WORK_STATUSES.find((row) => row.value === work.status)?.label ?? work.status)}
          </p>
          <p className="text-label text-ink-300">{t("Next decision:")} {t(decision.label)}</p>
          {work?.assignedBy != null && work?.assignedAt != null && (
            <p className="text-label text-ink-400">
              {t("Assigned by")} {work.assignedBy} · {formatDate(Date.parse(work.assignedAt), { dateStyle: "medium" })}
            </p>
          )}
          {work?.blockedReason != null && <p className="text-label text-ink-300">{t("Blocked:")} {work.blockedReason}</p>}
          {work === null && (
            <p className="text-label text-ink-400">{t("No work details are recorded. Content authorship is not an owner.")}</p>
          )}
          {conflict !== null && (
            <p className="text-label text-warn" role="alert">
              {t("These details changed; nothing was saved.")}{" "}
              {conflict.revision !== null && `${t("Current revision")} ${formatNumber(conflict.revision)}. `}
              {t("Your edits are still here.")}
            </p>
          )}
          {canWrite && (
            <form className="grid gap-2" onSubmit={submit}>
              <div className="crm-field-row">
                <Field label={t("Assigned to")} className="crm-field">
                  {(c) => (
                    <input {...c} className="field" value={assignee} maxLength={ASSIGNEE_MAX} autoComplete="off" disabled={saving} onChange={(event) => setAssignee(event.target.value)} />
                  )}
                </Field>
                <Field label={t("Due date")} hint="YYYY-MM-DD" className="crm-field">
                  {(c) => (
                    <input {...c} className="field" value={dueAt} maxLength={DUE_AT_LENGTH} inputMode="numeric" autoComplete="off" disabled={saving} onChange={(event) => setDueAt(event.target.value)} />
                  )}
                </Field>
              </div>
              <div className="crm-field-row">
                <Field label={t("Status")} className="crm-field">
                  {(c) => (
                    <Select id={c.id} value={status} onChange={setStatus} options={statusOptions} placeholder={t("Not set")} disabled={saving} full />
                  )}
                </Field>
                {status === "blocked" && (
                  <Field label={t("Blocked reason")} className="crm-field">
                    {(c) => (
                      <input {...c} className="field" value={blockedReason} maxLength={BLOCKED_REASON_MAX} autoComplete="off" disabled={saving} onChange={(event) => setBlockedReason(event.target.value)} />
                    )}
                  </Field>
                )}
              </div>
              {saveError !== null && <p className="text-label text-fail" role="alert">{t(saveError)}</p>}
              <div className="flex justify-end">
                <Button type="submit" size="sm" variant="primary" loading={saving} disabled={saving || !dirty}>{t("Save work")}</Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
