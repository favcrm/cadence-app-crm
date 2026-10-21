import { useLocale } from "../locale";
import { Button,Select } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import {
audienceClient,
type AudienceBaseInput,
type AudienceScope,
} from "../audienceClient";
import EligibilityFunnel from "../campaign/EligibilityFunnel";
import "../crm-campaign.css";
import { friendlyAudienceError,newAudienceId } from "../segmentGrammar";
import { PreviewPanel,parsePreview,parseSegmentList,type AudiencePreview } from "../segments/Segments";
import { useCrmQuery } from "../resources";
import type { Viewer } from "../viewer";


import { type AudiencePick } from "./audienceModel";

function parseIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((id) => id.trim()).filter((id) => id !== ""))];
}

export default function AudienceSection({
  scope,
  viewer,
  pick,
  onPick,
  onPreview,
  freezeSlot,
  layout = "full",
}: {
  scope: AudienceScope;
  viewer: Viewer;
  pick: AudiencePick;
  onPick: (pick: AudiencePick) => void;
  onPreview: (preview: AudiencePreview | null) => void;
  /** Optional freeze controls rendered under the preview. */
  freezeSlot?: React.ReactNode;
  /** CAD-1055: `detail` is the saved campaign's Audience tab — the
   *  picker and an eligibility funnel up front, exclusions and
   *  suppressions behind an Advanced disclosure. */
  layout?: "full" | "detail";
}) {
  const { t } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const segmentState = useCrmQuery(scope, "segments.list", {}, parseSegmentList);
  const segments = segmentState.data ?? [];
  const [exclusions, setExclusions] = useState<{ id: string; name: string }[]>([]);
  const [customIds, setCustomIds] = useState("");
  const [exclusionsError, setListsError] = useState<string | null>(null);
  const listsError = segmentState.error ?? exclusionsError;
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewForKey, setPreviewForKey] = useState<string | null>(null);
  const previewGeneration = useRef(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState(0);
  const [suppressions, setSuppressions] = useState<{ kind: string; key: string; reason: string }[]>([]);
  const [suppressionError, setSuppressionError] = useState<string | null>(null);
  const [suppressionToken, setSuppressionToken] = useState(0);
  const [showExclusionForm, setShowExclusionForm] = useState(false);
  const [exclusionName, setExclusionName] = useState("");
  const [exclusionIds, setExclusionIds] = useState("");
  const [exclusionPending, setExclusionPending] = useState(false);
  const [exclusionError, setExclusionError] = useState<string | null>(null);
  const [suppressEmail, setSuppressEmail] = useState("");
  const [suppressReason, setSuppressReason] = useState("");
  const [suppressPending, setSuppressPending] = useState(false);
  const [suppressError, setSuppressError] = useState<string | null>(null);

  const listsToken = scope.installId;
  useEffect(() => {
    if (!viewer.operator) return;
    const controller = new AbortController();
    setListsError(null);
    audienceClient.exclusionList(scope)
      .then((excValue) => {
        if (controller.signal.aborted) return;
        const excs = ((excValue as { exclusions?: unknown } | null)?.exclusions ?? []) as {
          id?: unknown;
          name?: unknown;
        }[];
        setExclusions(
          Array.isArray(excs)
            ? excs.flatMap((row) =>
                typeof row.id === "string" && typeof row.name === "string"
                  ? [{ id: row.id, name: row.name }]
                  : [],
              )
            : [],
        );
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setListsError(friendlyAudienceError(e));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsToken, suppressionToken]);

  useEffect(() => {
    if (!viewer.operator) return;
    const controller = new AbortController();
    audienceClient
      .suppressionList(scope)
      .then((value) => {
        if (controller.signal.aborted) return;
        const rows = ((value as { suppressions?: unknown } | null)?.suppressions ?? []) as {
          kind?: unknown;
          key?: unknown;
          reason?: unknown;
        }[];
        setSuppressions(
          Array.isArray(rows)
            ? rows.flatMap((row) =>
                typeof row.kind === "string" &&
                typeof row.key === "string" &&
                typeof row.reason === "string"
                  ? [{ kind: row.kind, key: row.key, reason: row.reason }]
                  : [],
              )
            : [],
        );
        setSuppressionError(null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setSuppressionError(friendlyAudienceError(e));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsToken, suppressionToken]);

  // Debounced host preview: exact counts and a bounded sample for the
  // one chosen base mode plus the saved exclusion list.
  const previewKey = JSON.stringify({ base: pick.base, exclusion: pick.exclusionListId });
  const currentPreview = previewForKey === previewKey ? preview : null;
  useEffect(() => {
    const generation = ++previewGeneration.current;
    if (!viewer.operator) {
      setPreview(null);
      setPreviewForKey(null);
      onPreview(null);
      return;
    }
    if (pick.base.mode === "custom" && pick.base.customerIds.length === 0) {
      setPreview(null);
      setPreviewForKey(null);
      onPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    setPreview(null);
    setPreviewForKey(null);
    onPreview(null);
    setPreviewLoading(true);
    setPreviewError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      audienceClient
        .preview(scope, pick.base, pick.exclusionListId ?? undefined)
        .then((value) => {
          if (controller.signal.aborted || generation !== previewGeneration.current) return;
          const parsed = parsePreview(value);
          setPreview(parsed);
          setPreviewForKey(previewKey);
          onPreview(parsed);
          setPreviewError(null);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || generation !== previewGeneration.current) return;
          setPreviewError(friendlyAudienceError(e));
          setPreview(null);
          setPreviewForKey(null);
          onPreview(null);
        })
        .finally(() => {
          if (!controller.signal.aborted && generation === previewGeneration.current) setPreviewLoading(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, listsToken, previewToken]);

  const setMode = (mode: AudienceBaseInput["mode"]) => {
    if (mode === "all") onPick({ ...pick, base: { mode: "all" } });
    else if (mode === "segment") {
      const first = segments[0]?.id ?? "";
      onPick({ ...pick, base: first === "" ? { mode: "all" } : { mode: "segment", segmentId: first } });
    } else {
      onPick({ ...pick, base: { mode: "custom", customerIds: parseIds(customIds) } });
    }
  };

  return (
    <section aria-label={t("Audience")} className="card px-4 py-4 grid gap-3">
      <h4 className="text-cardtitle font-medium text-ink-100">
        {layout === "detail" ? t("Send to") : t("Audience — one base mode")}
      </h4>
      {listsError && (
        <p className="text-label text-fail" role="alert">
          {listsError}
        </p>
      )}
      <div role="radiogroup" aria-label={t("Base audience mode")} className="crm-toolbar">
        {(
          [
            ["all", t("All eligible customers")],
            ["segment", t("One saved segment")],
            ["custom", t("Custom customer IDs")],
          ] as [AudienceBaseInput["mode"], string][]
        ).map(([mode, label]) => (
          <label key={mode} className="text-label text-ink-200">
            <input
              type="radio"
              name="audience-base-mode"
              checked={pick.base.mode === mode}
              disabled={!canWrite || (mode === "segment" && segments.length === 0)}
              onChange={() => setMode(mode)}
            />{" "}
            {label}
            {mode === "segment" && segments.length === 0 ? ` (${t("none saved yet")})` : ""}
          </label>
        ))}
      </div>
      {pick.base.mode === "segment" && (
        <div className="crm-field">
          <label className="text-label text-ink-300" htmlFor="aud-segment">
            {t("Saved segment")}
          </label>
          <Select
            id="aud-segment"
            value={pick.base.segmentId}
            onChange={(value) => onPick({ ...pick, base: { mode: "segment", segmentId: value } })}
            options={segments.map((row) => ({ value: row.id, label: `${row.name} · ${row.id}` }))}
            aria-label={t("Saved segment")}
            disabled={!canWrite}
            full
          />
        </div>
      )}
      {pick.base.mode === "custom" && (
        <div className="crm-field">
          <label className="text-label text-ink-300" htmlFor="aud-custom">
            {t("Customer IDs (comma or space separated — the final suppression union still applies)")}
          </label>
          <textarea
            id="aud-custom"
            className="field"
            rows={2}
            value={customIds}
            disabled={!canWrite}
            onChange={(e) => {
              setCustomIds(e.target.value);
              onPick({ ...pick, base: { mode: "custom", customerIds: parseIds(e.target.value) } });
            }}
            maxLength={8000}
            autoComplete="off"
            placeholder="cust-abc123, cust-def456"
          />
        </div>
      )}
      {layout === "detail" ? (
        <>
          <EligibilityFunnel
            preview={currentPreview}
            loading={previewLoading}
            error={previewError}
            onRetry={() => setPreviewToken((count) => count + 1)}
          />
          <details className="crm-diag" data-advanced>
            <summary className="text-label text-ink-300">{t("Advanced: exclusions and suppressions")}</summary>
            <div className="grid gap-3 mt-2">
      <div className="crm-field">
        <label className="text-label text-ink-300" htmlFor="aud-exclusion">
          {t("Saved exclusion list (applies on every base mode)")}</label>
        <Select
          id="aud-exclusion"
          value={pick.exclusionListId ?? ""}
          onChange={(value) => onPick({ ...pick, exclusionListId: value === "" ? null : value })}
          options={[
            { value: "", label: t("No exclusion list") },
            ...exclusions.map((row) => ({ value: row.id, label: `${row.name} · ${row.id}` })),
          ]}
          aria-label={t("Saved exclusion list")}
          disabled={!canWrite}
          full
        />
      </div>
      {canWrite && !showExclusionForm && (
        <p>
          <button type="button" className="lnk text-label" onClick={() => setShowExclusionForm(true)}>
            {t("+ New exclusion list")}</button>
        </p>
      )}
      {canWrite && showExclusionForm && (
        <form
          className="card px-3 py-3 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setExclusionError(null);
            const ids = parseIds(exclusionIds);
            if (exclusionName.trim() === "" || ids.length === 0 || ids.length > 100) {
              setExclusionError("an exclusion list needs a name and 1 to 100 customer IDs");
              return;
            }
            setExclusionPending(true);
            const listId = newAudienceId("exc");
            void audienceClient
              .exclusionSave(scope, { listId, name: exclusionName.trim(), memberIds: ids })
              .then(() => {
                setShowExclusionForm(false);
                setExclusionName("");
                setExclusionIds("");
                setSuppressionToken((count) => count + 1);
                onPick({ ...pick, exclusionListId: listId });
              })
              .catch((err: unknown) => setExclusionError(friendlyAudienceError(err)))
              .finally(() => setExclusionPending(false));
          }}
        >
          <div className="crm-field-row">
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-exc-name">
                {t("List name")}</label>
              <input
                id="aud-exc-name"
                className="field"
                value={exclusionName}
                onChange={(e) => setExclusionName(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={exclusionPending}
              />
            </div>
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-exc-ids">
                {t("Member customer IDs")}</label>
              <input
                id="aud-exc-ids"
                className="field"
                value={exclusionIds}
                onChange={(e) => setExclusionIds(e.target.value)}
                maxLength={8000}
                autoComplete="off"
                disabled={exclusionPending}
                placeholder="cust-abc123, cust-def456"
              />
            </div>
          </div>
          {exclusionError && (
            <p className="text-label text-fail" role="alert">
              {exclusionError}
            </p>
          )}
          <div className="crm-toolbar">
            <Button type="submit" size="sm" loading={exclusionPending} disabled={exclusionPending}>
              {t("Save exclusion list")}</Button>
            <button type="button" className="lnk text-label" onClick={() => setShowExclusionForm(false)}>
              {t("Cancel")}</button>
          </div>
        </form>
      )}
      <section aria-label={t("Suppressions")} className="mt-1">
        <h4 className="text-label font-medium text-ink-200">
          {t("Suppressions ({count}) — always excluded, even from custom IDs").replace("{count}", String(suppressions.length))}
        </h4>
        {suppressionError !== null ? (
          <p className="text-label text-fail" role="alert">
            {suppressionError}{" "}
            <button type="button" className="lnk" onClick={() => setSuppressionToken((count) => count + 1)}>
              {t("Retry")}</button>
          </p>
        ) : suppressions.length === 0 ? (
          <p className="text-label text-ink-400">{t("No suppressions yet.")}</p>
        ) : (
          <ol className="crm-history">
            {suppressions.slice(0, 10).map((row) => (
              <li key={`${row.kind}:${row.key}`} className="num text-label text-ink-300">
                {row.kind} · {row.key} · {row.reason}
              </li>
            ))}
            {suppressions.length > 10 && (
              <li className="num text-label text-ink-500">{t("…and {count} more").replace("{count}", String(suppressions.length - 10))}</li>
            )}
          </ol>
        )}
        {canWrite && (
          <form
            className="crm-field-row mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSuppressError(null);
              if (suppressEmail.trim() === "" || suppressReason.trim() === "") {
                setSuppressError("a suppression needs an email address and a reason");
                return;
              }
              setSuppressPending(true);
              void audienceClient
                .suppressionAdd(scope, { email: suppressEmail.trim(), reason: suppressReason.trim() })
                .then(() => {
                  setSuppressEmail("");
                  setSuppressReason("");
                  setSuppressionToken((count) => count + 1);
                  setPreviewToken((count) => count + 1);
                })
                .catch((err: unknown) => setSuppressError(friendlyAudienceError(err)))
                .finally(() => setSuppressPending(false));
            }}
          >
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-suppress-email">
                {t("Suppress an email")}</label>
              <input
                id="aud-suppress-email"
                className="field"
                type="email"
                value={suppressEmail}
                onChange={(e) => setSuppressEmail(e.target.value)}
                maxLength={254}
                autoComplete="off"
                disabled={suppressPending}
                placeholder="name@example.com"
              />
            </div>
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-suppress-reason">
                {t("Reason")}</label>
              <input
                id="aud-suppress-reason"
                className="field"
                value={suppressReason}
                onChange={(e) => setSuppressReason(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={suppressPending}
                placeholder={t("opted out by phone")}
              />
            </div>
            {suppressError && (
              <p className="text-label text-fail" role="alert">
                {suppressError}
              </p>
            )}
            <div>
              <Button type="submit" size="sm" loading={suppressPending} disabled={suppressPending}>
                {t("Add suppression")}</Button>
            </div>
          </form>
        )}
      </section>
            </div>
          </details>
        </>
      ) : (
        <>
      <div className="crm-field">
        <label className="text-label text-ink-300" htmlFor="aud-exclusion">
          {t("Saved exclusion list (applies on every base mode)")}</label>
        <Select
          id="aud-exclusion"
          value={pick.exclusionListId ?? ""}
          onChange={(value) => onPick({ ...pick, exclusionListId: value === "" ? null : value })}
          options={[
            { value: "", label: t("No exclusion list") },
            ...exclusions.map((row) => ({ value: row.id, label: `${row.name} · ${row.id}` })),
          ]}
          aria-label={t("Saved exclusion list")}
          disabled={!canWrite}
          full
        />
      </div>
      {canWrite && !showExclusionForm && (
        <p>
          <button type="button" className="lnk text-label" onClick={() => setShowExclusionForm(true)}>
            {t("+ New exclusion list")}</button>
        </p>
      )}
      {canWrite && showExclusionForm && (
        <form
          className="card px-3 py-3 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setExclusionError(null);
            const ids = parseIds(exclusionIds);
            if (exclusionName.trim() === "" || ids.length === 0 || ids.length > 100) {
              setExclusionError("an exclusion list needs a name and 1 to 100 customer IDs");
              return;
            }
            setExclusionPending(true);
            const listId = newAudienceId("exc");
            void audienceClient
              .exclusionSave(scope, { listId, name: exclusionName.trim(), memberIds: ids })
              .then(() => {
                setShowExclusionForm(false);
                setExclusionName("");
                setExclusionIds("");
                setSuppressionToken((count) => count + 1);
                onPick({ ...pick, exclusionListId: listId });
              })
              .catch((err: unknown) => setExclusionError(friendlyAudienceError(err)))
              .finally(() => setExclusionPending(false));
          }}
        >
          <div className="crm-field-row">
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-exc-name">
                {t("List name")}</label>
              <input
                id="aud-exc-name"
                className="field"
                value={exclusionName}
                onChange={(e) => setExclusionName(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={exclusionPending}
              />
            </div>
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-exc-ids">
                {t("Member customer IDs")}</label>
              <input
                id="aud-exc-ids"
                className="field"
                value={exclusionIds}
                onChange={(e) => setExclusionIds(e.target.value)}
                maxLength={8000}
                autoComplete="off"
                disabled={exclusionPending}
                placeholder="cust-abc123, cust-def456"
              />
            </div>
          </div>
          {exclusionError && (
            <p className="text-label text-fail" role="alert">
              {exclusionError}
            </p>
          )}
          <div className="crm-toolbar">
            <Button type="submit" size="sm" loading={exclusionPending} disabled={exclusionPending}>
              {t("Save exclusion list")}</Button>
            <button type="button" className="lnk text-label" onClick={() => setShowExclusionForm(false)}>
              {t("Cancel")}</button>
          </div>
        </form>
      )}
      <PreviewPanel
        preview={currentPreview}
        loading={previewLoading}
        error={previewError}
        onRetry={() => setPreviewToken((count) => count + 1)}
        label={t("Audience preview")}
      />
      <section aria-label={t("Suppressions")} className="mt-1">
        <h4 className="text-label font-medium text-ink-200">
          {t("Suppressions ({count}) — always excluded, even from custom IDs").replace("{count}", String(suppressions.length))}
        </h4>
        {suppressionError !== null ? (
          <p className="text-label text-fail" role="alert">
            {suppressionError}{" "}
            <button type="button" className="lnk" onClick={() => setSuppressionToken((count) => count + 1)}>
              {t("Retry")}</button>
          </p>
        ) : suppressions.length === 0 ? (
          <p className="text-label text-ink-400">{t("No suppressions yet.")}</p>
        ) : (
          <ol className="crm-history">
            {suppressions.slice(0, 10).map((row) => (
              <li key={`${row.kind}:${row.key}`} className="num text-label text-ink-300">
                {row.kind} · {row.key} · {row.reason}
              </li>
            ))}
            {suppressions.length > 10 && (
              <li className="num text-label text-ink-500">{t("…and {count} more").replace("{count}", String(suppressions.length - 10))}</li>
            )}
          </ol>
        )}
        {canWrite && (
          <form
            className="crm-field-row mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSuppressError(null);
              if (suppressEmail.trim() === "" || suppressReason.trim() === "") {
                setSuppressError("a suppression needs an email address and a reason");
                return;
              }
              setSuppressPending(true);
              void audienceClient
                .suppressionAdd(scope, { email: suppressEmail.trim(), reason: suppressReason.trim() })
                .then(() => {
                  setSuppressEmail("");
                  setSuppressReason("");
                  setSuppressionToken((count) => count + 1);
                  setPreviewToken((count) => count + 1);
                })
                .catch((err: unknown) => setSuppressError(friendlyAudienceError(err)))
                .finally(() => setSuppressPending(false));
            }}
          >
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-suppress-email">
                {t("Suppress an email")}</label>
              <input
                id="aud-suppress-email"
                className="field"
                type="email"
                value={suppressEmail}
                onChange={(e) => setSuppressEmail(e.target.value)}
                maxLength={254}
                autoComplete="off"
                disabled={suppressPending}
                placeholder="name@example.com"
              />
            </div>
            <div className="crm-field">
              <label className="text-label text-ink-300" htmlFor="aud-suppress-reason">
                {t("Reason")}</label>
              <input
                id="aud-suppress-reason"
                className="field"
                value={suppressReason}
                onChange={(e) => setSuppressReason(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={suppressPending}
                placeholder={t("opted out by phone")}
              />
            </div>
            {suppressError && (
              <p className="text-label text-fail" role="alert">
                {suppressError}
              </p>
            )}
            <div>
              <Button type="submit" size="sm" loading={suppressPending} disabled={suppressPending}>
                {t("Add suppression")}</Button>
            </div>
          </form>
        )}
      </section>
        </>
      )}
      {freezeSlot}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Visual email editor + host preview + test-send + proposals.         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Send controls (CAD-785 binding + CAD-786 approved bounded send).     */
/* ------------------------------------------------------------------ */

/** One recipient's masked row plus the uncertain-only resolve pair. */
