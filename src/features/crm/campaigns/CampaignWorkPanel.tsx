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
  workRevision,
  workStatusLabel,
  type CampaignWorkFacts,
  type WorkRecord,
  type WorkStatus,
} from "../../../domain/campaignWork";
import { getScope } from "../../../bridge/scope";
import { campaignWorkClient, type WorkScope, type WorkWriteInput } from "../campaignWorkClient";
import type { ReadinessItem } from "../campaign/readiness";

/**
 * Campaign work: who owns the campaign, when it is due, what lifecycle it
 * reached and the app-computed next decision (CRM-12).
 *
 * Nothing is inferred. A campaign with no recorded work shows "Unassigned"
 * and "not set" values; a host that does not advertise the campaign-work
 * operations shows an explicit unavailable note instead of a form. The
 * next decision comes from the same readiness chain the Overview checklist
 * renders, so the two can never disagree. A save carries the revision the
 * panel read; a stale revision is refused and re-read, never overwritten.
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
  const [error, setError] = useState<string | null>(null);
  /** Why the panel cannot read: the host lacks the operations, the caller
   *  is forbidden, or the campaign has no source row. Never a fallback. */
  const [blocked, setBlocked] = useState<"host" | "forbidden" | "missing" | null>(null);
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
    if (reason instanceof ApiError && reason.status === 404) {
      setBlocked("missing");
      return;
    }
    setError(reason instanceof ApiError ? reason.message : "Couldn't read the campaign work details.");
  };

  const load = () => {
    const current = ++generation.current;
    setLoading(true);
    setBlocked(null);
    setError(null);
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

  /** Only what actually changed travels, always with the revision read. */
  const patchFor = (loaded: WorkRecord | null): WorkWriteInput => {
    const patch: WorkWriteInput = { campaignId, expectedRevision: workRevision(loaded) };
    const nextAssignee = assignee.trim();
    if (nextAssignee !== (loaded?.assignee ?? "")) patch.assignee = nextAssignee === "" ? null : nextAssignee;
    const nextDue = dueAt.trim();
    if (nextDue !== (loaded?.dueAt ?? "")) patch.dueAt = nextDue === "" ? null : nextDue;
    if (status !== (loaded?.status ?? "")) patch.status = status === "" ? null : (status as WorkStatus);
    if (status === "blocked" && blockedReason.trim() !== (loaded?.blockedReason ?? "")) {
      patch.blockedReason = blockedReason.trim() === "" ? null : blockedReason.trim();
    }
    return patch;
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || view === null || saving) return;
    let patch: WorkWriteInput;
    try {
      patch = patchFor(view.work);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : "That work detail is not valid.");
      return;
    }
    setSaving(true);
    setError(null);
    campaignWorkClient.save(scope, patch).then((raw) => {
      const facts = parseWorkView(raw);
      setView(facts);
      seed(facts.work);
    }).catch((reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 409) {
        setError("These campaign work details changed. Reload them before saving again.");
        load();
      } else if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        fail(reason);
      } else {
        setError(reason instanceof ApiError ? reason.message : "Couldn't save the campaign work details.");
      }
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
            ? t("Campaign work isn't available on this host, so no assignment or status is shown.")
            : blocked === "forbidden"
              ? t("You don't have access to this campaign's work details.")
              : t("This campaign has no work record on the source.")}
        </p>
      )}
      {!loading && blocked === null && view !== null && (
        <>
          <p className="text-label" data-work-summary>
            {work?.assignee ?? t("Unassigned")} · {work?.dueAt ?? t("No due date")} · {work?.status == null ? t("Status not set") : t(workStatusLabel(work.status))}
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
              {error !== null && <p className="text-label text-fail" role="alert">{t(error)}</p>}
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
