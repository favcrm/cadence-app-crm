import { useLocale } from "../locale";
import { Button, Detail, ErrorNotice, Field, Loading, Notice, Select } from "@cadence/screen-ui";
import { useEffect, useState } from "react";
import FrameDrawer from "../FrameDrawer";
import { consentLabel, viewProfile, type ConsentSetting } from "../customerProfile";
import { hostActions, type HostRecord, type HostScope } from "../hostActions";
import { hostErrorText } from "../hostErrors";

function strictestConsent(a: string | null | undefined, b: string | null | undefined): ConsentSetting {
  if (a === "denied" || b === "denied") return "denied";
  if (a === "granted" && b === "granted") return "granted";
  return "unknown";
}

export default function MergeCustomerDrawer({
  scope,
  source,
  onClose,
  onMerged,
}: {
  scope: HostScope;
  source: HostRecord;
  onClose: () => void;
  onMerged: (targetId: string) => void;
}) {
  const { t } = useLocale();
  const sourceView = viewProfile(source.profile);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<HostRecord[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [targetId, setTargetId] = useState("");
  const [targetRecord, setTargetRecord] = useState<HostRecord | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(false);

  const [overrideName, setOverrideName] = useState("");
  const [overrideEmail, setOverrideEmail] = useState("");
  const [overridePhone, setOverridePhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingList(true);
    void hostActions
      .list(scope, { query: search.trim() || undefined, limit: 50 })
      .then((res) => {
        if (!active) return;
        const others = res.records.filter((r) => r.id !== source.id);
        setCandidates(others);
        if (!targetId && others[0]) setTargetId(others[0].id);
      })
      .catch((err: unknown) => {
        if (active) setError(hostErrorText(err, t("Could not load customers to merge into.")));
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [scope, source.id, search, t]);

  useEffect(() => {
    if (!targetId) {
      setTargetRecord(null);
      return;
    }
    let active = true;
    setLoadingTarget(true);
    setError(null);
    void hostActions
      .show(scope, targetId)
      .then((rec) => {
        if (!active) return;
        setTargetRecord(rec);
        const tv = viewProfile(rec.profile);
        setOverrideName(tv.displayName || sourceView.displayName);
        setOverrideEmail(tv.email ?? sourceView.email ?? "");
        setOverridePhone(tv.phone ?? sourceView.phone ?? "");
      })
      .catch((err: unknown) => {
        if (active) setError(hostErrorText(err, t("Could not load target customer.")));
      })
      .finally(() => {
        if (active) setLoadingTarget(false);
      });
    return () => {
      active = false;
    };
  }, [scope, targetId, sourceView.displayName, sourceView.email, sourceView.phone, t]);

  const targetView = targetRecord ? viewProfile(targetRecord.profile) : null;
  const mergedEmailConsent = targetView
    ? strictestConsent(sourceView.consentEmail, targetView.consentEmail)
    : "unknown";
  const mergedSmsConsent = targetView
    ? strictestConsent(sourceView.consentSms, targetView.consentSms)
    : "unknown";

  const confirmMerge = async () => {
    if (pending || !targetRecord) return;
    setPending(true);
    setError(null);
    try {
      const result = await hostActions.mergeCustomers(scope, {
        sourceId: source.id,
        targetId: targetRecord.id,
        expectedSourceRevision: source.revision,
        expectedTargetRevision: targetRecord.revision,
        overrides: {
          ...(overrideName.trim() ? { display_name: overrideName.trim() } : {}),
          ...(overrideEmail.trim() ? { email: overrideEmail.trim() } : { email: null }),
          ...(overridePhone.trim() ? { phone: overridePhone.trim() } : { phone: null }),
        },
      });
      onMerged(result.record.id);
    } catch (err: unknown) {
      setError(hostErrorText(err, t("Could not merge customers.")));
    } finally {
      setPending(false);
    }
  };

  const options = candidates.map((rec) => {
    const pv = viewProfile(rec.profile);
    return {
      value: rec.id,
      label: `${pv.displayName}${pv.email ? ` (${pv.email})` : ""}`,
    };
  });

  const panel = (
    <div className="crm-list">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Notice>
        {t("Merging moves all notes, deals, tasks, and touchpoints onto the target customer and deletes this duplicate record. Strictest marketing consent always wins and cannot be weakened.")}
      </Notice>
      <Field id="crm-merge-search" label={t("Find surviving target customer")}>
        {(c) => (
          <input
            {...c}
            className="field"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search customers…")}
            disabled={pending}
          />
        )}
      </Field>
      {loadingList ? (
        <Loading>{t("Reading customers…")}</Loading>
      ) : options.length === 0 ? (
        <p className="text-secondary text-ink-400">{t("No other customers match your search.")}</p>
      ) : (
        <Field id="crm-merge-target" label={t("Surviving target customer")}>
          {(c) => (
            <Select
              {...c}
              value={targetId}
              onChange={setTargetId}
              options={options}
              disabled={pending}
            />
          )}
        </Field>
      )}
      {loadingTarget && <Loading>{t("Reading target customer…")}</Loading>}
      {targetRecord && targetView && (
        <>
          <Detail
            className="crm-detail"
            label={t("Merge comparison")}
            items={[
              {
                key: "source",
                term: t("Duplicate (will be deleted)"),
                value: `${sourceView.displayName} (${source.id} · r${source.revision})`,
              },
              {
                key: "target",
                term: t("Surviving target"),
                value: `${targetView.displayName} (${targetRecord.id} · r${targetRecord.revision})`,
              },
              {
                key: "email-consent",
                term: t("Merged email consent"),
                value: t(consentLabel(mergedEmailConsent)),
              },
              {
                key: "sms-consent",
                term: t("Merged SMS consent"),
                value: t(consentLabel(mergedSmsConsent)),
              },
            ]}
          />
          <Field id="crm-merge-name" label={t("Final display name")}>
            {(c) => (
              <input
                {...c}
                className="field"
                value={overrideName}
                maxLength={200}
                onChange={(e) => setOverrideName(e.target.value)}
                disabled={pending}
              />
            )}
          </Field>
          <Field id="crm-merge-email" label={t("Final email")}>
            {(c) => (
              <input
                {...c}
                className="field"
                value={overrideEmail}
                maxLength={254}
                onChange={(e) => setOverrideEmail(e.target.value)}
                disabled={pending}
              />
            )}
          </Field>
          <Field id="crm-merge-phone" label={t("Final phone")}>
            {(c) => (
              <input
                {...c}
                className="field"
                value={overridePhone}
                maxLength={24}
                onChange={(e) => setOverridePhone(e.target.value)}
                disabled={pending}
              />
            )}
          </Field>
        </>
      )}
    </div>
  );

  return (
    <FrameDrawer
      kind="customer"
      label={t("Merge duplicate")}
      title={`${t("Merge duplicate")}: ${sourceView.displayName}`}
      tabs={[{ id: "merge", label: t("Merge"), panel }]}
      onClose={onClose}
      secondary={<Button onClick={onClose} disabled={pending}>{t("Cancel")}</Button>}
      primary={
        <Button
          variant="primary"
          onClick={() => void confirmMerge()}
          disabled={pending || !targetRecord || loadingTarget}
        >
          {t(pending ? "Merging…" : "Confirm merge")}
        </Button>
      }
    />
  );
}
