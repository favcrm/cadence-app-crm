import { useLocale } from "../locale";
import { Button,Select } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import {
audienceClient,
type AudienceBaseInput,
type AudienceScope,
} from "../audienceClient";
import EligibilityFunnel from "../campaign/EligibilityFunnel";
import type { useAudiencePreview } from "../campaign/useAudiencePreview";
import "../crm-campaign.css";
import { friendlyAudienceError,newAudienceId } from "../segmentGrammar";
import type { SegmentDoc } from "../segments/Segments";
import type { Viewer } from "../viewer";


import { type AudiencePick } from "./audienceModel";

export function parseIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((id) => id.trim()).filter((id) => id !== ""))];
}

type Mode = AudienceBaseInput["mode"];
const MODES: { mode: Mode; title: string; hint: string }[] = [
  { mode: "all", title: "Everyone", hint: "All customers who can be emailed." },
  { mode: "segment", title: "Saved segment", hint: "Customers who match a segment." },
  { mode: "custom", title: "Chosen customers", hint: "Customers you list by ID." },
];

/** How the choice is kept, said without implying more than is true. */
export type AudienceKeeping = "saved" | "saving" | "waiting" | "memory" | "html" | "failed";

export default function AudienceSection({
  scope,
  viewer,
  pick,
  onPick,
  segments,
  count,
  keeping,
  onRetrySave,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  pick: AudiencePick;
  onPick: (pick: AudiencePick) => void;
  segments: SegmentDoc[];
  count: ReturnType<typeof useAudiencePreview>;
  keeping: AudienceKeeping;
  onRetrySave: () => void;
}) {
  const { t } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const [exclusions, setExclusions] = useState<{ id: string; name: string }[]>([]);
  const [customIds, setCustomIds] = useState(() => (pick.base?.mode === "custom" ? pick.base.customerIds.join(", ") : ""));
  const [exclusionsError, setListsError] = useState<string | null>(null);
  const listsError = exclusionsError;
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
  const radios = useRef<Record<string, HTMLButtonElement | null>>({});

  // A restored or externally changed custom list reseeds the box; typing
  // never does, so the caret and the text stay the owner's.
  const baseIds = pick.base?.mode === "custom" ? pick.base.customerIds.join(", ") : null;
  useEffect(() => {
    if (baseIds !== null && JSON.stringify(parseIds(customIds)) !== JSON.stringify(parseIds(baseIds))) setCustomIds(baseIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseIds]);

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

  const disabled = (mode: Mode) => !canWrite || (mode === "segment" && segments.length === 0);
  const chosen = pick.base?.mode ?? null;
  const choose = (mode: Mode) => {
    if (disabled(mode) || chosen === mode) return;
    if (mode === "all") onPick({ ...pick, base: { mode: "all" } });
    else if (mode === "segment") onPick({ ...pick, base: { mode: "segment", segmentId: segments[0]!.id } });
    else onPick({ ...pick, base: { mode: "custom", customerIds: parseIds(customIds) } });
  };
  // Nothing is chosen until the owner chooses: the first option takes the
  // tab stop, but only a press or an arrow key selects it.
  const enabled = MODES.filter((row) => !disabled(row.mode));
  const stop = chosen !== null && !disabled(chosen) ? chosen : enabled[0]?.mode ?? null;
  const onKey = (event: React.KeyboardEvent, mode: Mode) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
    if (step === undefined || enabled.length === 0) return;
    event.preventDefault();
    const from = enabled.findIndex((row) => row.mode === mode);
    const next = enabled[(from + step + enabled.length) % enabled.length]!;
    choose(next.mode);
    radios.current[next.mode]?.focus();
  };
  const keepingLine: Record<AudienceKeeping, string> = {
    saved: "Your choice stays with this campaign.",
    saving: "Saving your choice…",
    waiting: "Your choice will be saved once the email changes are saved or discarded.",
    memory: "This version of Cadence can't keep the audience with the campaign. Your choice is kept on this screen only.",
    html: "This campaign uses pasted HTML, so its audience is kept on this screen only.",
    failed: "Your choice wasn't saved.",
  };

  return (
    <section aria-label={t("Audience")} className="card px-4 py-4 grid gap-3">
      <h4 className="text-cardtitle font-medium text-ink-100">{t("Send to")}</h4>
      {listsError && (
        <p className="text-label text-fail" role="alert">
          {listsError}
        </p>
      )}
      <div className="crm-starts" role="radiogroup" aria-label={t("Audience")}>
        {MODES.map((row) => (
          <button
            key={row.mode}
            ref={(node) => { radios.current[row.mode] = node; }}
            type="button"
            role="radio"
            className="crm-start"
            data-audience={row.mode}
            aria-checked={chosen === row.mode}
            tabIndex={stop === row.mode ? 0 : -1}
            disabled={disabled(row.mode)}
            onClick={() => choose(row.mode)}
            onKeyDown={(event) => onKey(event, row.mode)}
          >
            <span className="crm-start-title crm-radio-title">
              <span className="crm-radio" aria-hidden="true" />
              {t(row.title)}
            </span>
            <span className="crm-start-hint crm-radio-hint">
              {row.mode === "segment" && segments.length === 0 ? t("No saved segments yet.") : t(row.hint)}
            </span>
          </button>
        ))}
      </div>
      {pick.base?.mode === "segment" && (
        <div className="crm-field">
          <label className="text-label text-ink-300" htmlFor="aud-segment">
            {t("Segment")}
          </label>
          <Select
            id="aud-segment"
            value={pick.base.segmentId}
            onChange={(value) => onPick({ ...pick, base: { mode: "segment", segmentId: value } })}
            options={[
              ...segments.map((row) => ({ value: row.id, label: row.name })),
              // A restored segment that is no longer listed stays visible.
              ...(segments.some((row) => row.id === (pick.base as { segmentId: string }).segmentId) ? [] : [{ value: pick.base.segmentId, label: pick.base.segmentId }]),
            ]}
            aria-label={t("Segment")}
            disabled={!canWrite}
            full
          />
        </div>
      )}
      {pick.base?.mode === "custom" && (
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
      {pick.base === null ? (
        <p className="text-label text-ink-400">{t("Choose who receives this.")}</p>
      ) : (
        <EligibilityFunnel
          preview={count.preview}
          loading={count.loading}
          error={count.error}
          onRetry={count.recount}
        />
      )}
      {pick.base !== null && (
        <p className="text-micro text-ink-500" role="status" data-keeping={keeping}>
          {t(keepingLine[keeping])}{" "}
          {keeping === "failed" && (
            <button type="button" className="lnk" onClick={onRetrySave}>{t("Retry")}</button>
          )}
        </p>
      )}
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
                  count.recount();
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
    </section>
  );
}
