import { useLocale } from "../locale";
import { ApiError,Button,DrawerShell,EmptyState,ErrorNotice,Field,Loading,Notice,Select,type DrawerTab } from "@cadence/screen-ui";
import { useEffect,useMemo,useRef,useState } from "react";
import { patchRoute } from "../../../bridge/route";
import { onScopeRetired } from "../../../bridge/scope";
import { useSurface } from "../../../bridge/presentation";
import {
audienceClient,
type AudienceScope,
type SegmentPredicate,
} from "../audienceClient";
import {
checkPredicate,
checkSegmentName,
friendlyAudienceError,
isSegmentField,
isSegmentOp,
newAudienceId,
SEGMENT_FIELDS,
SEGMENT_OPS,
} from "../segmentGrammar";
import type { Viewer } from "../viewer";
import { QueryRefresh,useCrmQuery } from "../resources";
import { useListMemory } from "../listMemory";
import ListPager, { LIST_PAGE_SIZE } from "../ListPager";

/** Human-readable predicate: the same labels the rule form offers.
 *  Unknown stored values fall back to the raw tokens, never hide. */
export function describeRule(rule: SegmentPredicate, translate: (value: string) => string = (value) => value): string {
  const field = SEGMENT_FIELDS.find((f) => f.value === rule.field)?.label ?? rule.field;
  const op = SEGMENT_OPS.find((o) => o.value === rule.op)?.label ?? rule.op;
  return translate("{field} {op} {value}").replace("{field}", () => translate(field)).replace("{op}", () => translate(op)).replace("{value}", () => rule.value);
}

/** Rule as a sentence of tokens: "Customers where [tag] [is] [vip]". */
function RuleSentence({ rules }: { rules: SegmentPredicate[] }) {
  const { t } = useLocale();
  return (
    <p className="crm-rule-sentence" data-testid="rule-sentence">
      <span>{t("Customers where")}</span>
      {rules.map((rule, i) => (
        <span key={i} className="crm-rule-sentence">
          {i > 0 && <span>{t("and")}</span>}
          <span className="chip">{t(SEGMENT_FIELDS.find((f) => f.value === rule.field)?.label ?? rule.field)}</span>
          <span className="chip">{t(SEGMENT_OPS.find((o) => o.value === rule.op)?.label ?? rule.op)}</span>
          <span className="chip">{rule.value}</span>
        </span>
      ))}
    </p>
  );
}

export interface FunnelStep {
  label: string;
  count: number;
}

/** Eligibility funnel built only from the host's membership-preview
 *  counts, plus the one plain-language reason that blocks most people. */
export function eligibilityFunnel(p: AudiencePreview, translate: (value: string) => string = (value) => value): { steps: FunnelStep[]; reason: string | null } {
  const valid = Math.max(p.finalCount, p.baseCount - p.excluded.invalid);
  const consent = Math.max(p.finalCount, valid - p.excluded.noConsent - p.excluded.unsubscribed);
  const steps = [
    { label: translate("Match the rule"), count: p.baseCount },
    { label: translate("Valid email"), count: valid },
    { label: translate("Email consent"), count: consent },
    { label: translate("Can be emailed"), count: p.finalCount },
  ];
  const causes: { count: number; one: string; many: string }[] = [
    { count: p.excluded.noConsent, one: translate("has not agreed to receive email"), many: translate("have not agreed to receive email") },
    { count: p.excluded.unsubscribed, one: translate("has unsubscribed"), many: translate("have unsubscribed") },
    { count: p.excluded.invalid, one: translate("has no valid email address"), many: translate("have no valid email address") },
    { count: p.excluded.suppressed, one: translate("is on the suppression list"), many: translate("are on the suppression list") },
    { count: p.exclusionCount, one: translate("is on the saved exclusion list"), many: translate("are on the saved exclusion list") },
  ];
  const top = causes.filter((cause) => cause.count > 0).sort((a, b) => b.count - a.count)[0];
  let reason: string | null = null;
  if (p.baseCount === 0) reason = translate("No customers match this rule yet.");
  else if (p.finalCount === 0 && top) reason = translate("Nobody can be emailed: {count} {unit} {cause}.")
    .replace("{count}", () => String(top.count))
    .replace("{unit}", () => translate(top.count === 1 ? "customer" : "customers"))
    .replace("{cause}", () => (top.count === 1 ? top.one : top.many));
  else if (p.finalCount < p.baseCount && top) reason = translate("{count} {unit} {cause}.")
    .replace("{count}", () => String(top.count))
    .replace("{unit}", () => translate(top.count === 1 ? "customer" : "customers"))
    .replace("{cause}", () => (top.count === 1 ? top.one : top.many));
  return { steps, reason };
}

/**
 * Saved-rule segment screens inside the trusted CRM shell (CAD-784
 * over the CAD-780 audience engine). List, separate New page and a
 * right detail drawer with the host's exact current-match preview —
 * no sample rows anywhere. The outlet remounts on every
 * install/context switch (the shell keys it on scope), so no draft
 * survives the boundary.
 *
 * A New segment cannot preview before it exists: the host preview
 * action addresses a saved rule, so Create lands atomically on the
 * detail drawer where the exact counts, suppression breakdown and
 * bounded sample render.
 *
 * The shell's own header row is the single Apps → App breadcrumb and
 * title; the section renders its own real heading instead of a
 * second crumb (CAD-863 release correction).
 */

const NO_SEGMENTS: SegmentDoc[] = [];
// Cleanup cancels dispatch, not an in-flight bridge read; keep one producer across list remounts.
let segmentCountReads: Promise<void> = Promise.resolve();
export interface SegmentDoc {
  id: string;
  revision: number;
  name: string;
  predicates: SegmentPredicate[];
  digest: string;
}

export function parseSegment(value: unknown): SegmentDoc {
  const doc = (value as { segment?: unknown } | null)?.segment;
  if (!doc || typeof doc !== "object") {
    throw new ApiError("The server returned an invalid segment receipt", 502);
  }
  const row = doc as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.revision !== "number" ||
    typeof row.name !== "string" ||
    typeof row.digest !== "string" ||
    !Array.isArray(row.predicates)
  ) {
    throw new ApiError("The server returned an invalid segment receipt", 502);
  }
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    predicates: row.predicates as SegmentPredicate[],
    digest: row.digest,
  };
}

export function parseSegmentList(value: unknown): SegmentDoc[] {
  const rows = (value as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(rows)) {
    throw new ApiError("The server returned an invalid segment receipt", 502);
  }
  return rows.map((row) => parseSegment({ segment: row }));
}

export interface AudiencePreview {
  baseCount: number;
  exclusionCount: number;
  excluded: { invalid: number; noConsent: number; unsubscribed: number; suppressed: number };
  finalCount: number;
  sample: { id: string; displayName: string }[];
  digest: string;
}

export function parsePreview(value: unknown): AudiencePreview {
  const root = (value as Record<string, unknown> | null) ?? {};
  const excluded = (root.final_excluded as Record<string, unknown> | undefined) ?? {};
  const sample = Array.isArray(root.sample) ? root.sample : [];
  const num = (slot: unknown): number => (typeof slot === "number" ? slot : -1);
  if (
    num(root.base_count) < 0 ||
    num(root.final_count) < 0 ||
    num(excluded.invalid_email) < 0 ||
    num(excluded.no_consent) < 0 ||
    num(excluded.unsubscribed) < 0 ||
    num(excluded.suppressed) < 0 ||
    typeof root.digest !== "string"
  ) {
    throw new ApiError("The server returned an invalid audience receipt", 502);
  }
  return {
    baseCount: root.base_count as number,
    exclusionCount: typeof root.exclusion_count === "number" ? root.exclusion_count : 0,
    excluded: {
      invalid: excluded.invalid_email as number,
      noConsent: excluded.no_consent as number,
      unsubscribed: excluded.unsubscribed as number,
      suppressed: excluded.suppressed as number,
    },
    finalCount: root.final_count as number,
    sample: sample.map((entry) => {
      const row = (entry as Record<string, unknown> | null) ?? {};
      return {
        id: typeof row.id === "string" ? row.id : "",
        displayName: typeof row.display_name === "string" ? row.display_name : "",
      };
    }),
    digest: root.digest as string,
  };
}

export default function CrmSegments({
  scope,
  viewer,
  view,
  recordId,
  onView,
  onSelect,
  onRecordCreated,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  view: "list" | "new";
  recordId: string | null;
  onView: (view: "list" | "new") => void;
  onSelect: (recordId: string | null) => void;
  onRecordCreated?: (recordId: string) => void;
}) {
  // While the host's independent overlay is modal the list behind it is
  // inert, not merely covered, so keyboard focus stays in the detail.
  const hostModal = useSurface().modal;
  return (
    <div className="crm-list" data-section="segments">
      <div className="crm-surface" inert={hostModal}>
        {view === "list" && (
          <SegmentList
            scope={scope}
            viewer={viewer}
            onSelect={onSelect}
            onNew={() => onView("new")}
          />
        )}
        {view === "new" && (
          <SegmentNew
            scope={scope}
            viewer={viewer}
            onCreated={(id) => {
              if (onRecordCreated) onRecordCreated(id);
              else {
                onView("list");
                onSelect(id);
              }
            }}
            onCancel={() => onView("list")}
          />
        )}
      </div>
      {recordId !== null && (
        <SegmentDrawer
          scope={scope}
          segmentId={recordId}
          viewer={viewer}
          canWrite={viewer.operator === true && !viewer.readOnly}
          onClose={() => onSelect(null)}
          onOpen={onSelect}
        />
      )}
    </div>
  );
}

function SegmentList({
  scope,
  viewer,
  onSelect,
  onNew,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  onSelect: (segmentId: string) => void;
  onNew: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const queryState = useCrmQuery(scope, "segments.list", {}, parseSegmentList);
  const segments = queryState.data ?? NO_SEGMENTS;
  const { loading, error } = queryState;
  const listRef = useListMemory(scope, "segments", viewer.operator === true && queryState.data !== null, queryState.failure);
  const [counts, setCounts] = useState<Record<string, AudiencePreview | null>>({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return segments.filter(segment => `${segment.name} ${segment.id}`.toLocaleLowerCase().includes(search));
  }, [segments, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = useMemo(() => filtered.slice(currentPage * LIST_PAGE_SIZE, (currentPage + 1) * LIST_PAGE_SIZE), [filtered, currentPage]);

  // Per-row exact host counts (bounded); a failed row shows an em dash.
  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = onScopeRetired(() => controller.abort());
    segmentCountReads = segmentCountReads.then(async () => {
      for (const segment of shown) {
        if (controller.signal.aborted) return;
        try {
          const value = await audienceClient.preview(scope, { mode: "segment", segmentId: segment.id });
          if (!controller.signal.aborted) setCounts((c) => ({ ...c, [segment.id]: parsePreview(value) }));
        } catch {
          if (!controller.signal.aborted) setCounts((c) => ({ ...c, [segment.id]: null }));
        }
      }
    });
    return () => { controller.abort(); unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);


  return (
    <section ref={listRef} aria-label={t("Segments list")} className="crm-list crm-list-controls">
      <h3 className="text-cardtitle font-medium text-ink-100" data-outlet-heading>
        {t("Segments")}
      </h3>
      <div className="crm-toolbar crm-list-toolbar">
        <div className="crm-search">
          <label className="sr-only" htmlFor="crm-segment-search">{t("Search segments")}</label>
          <input
            id="crm-segment-search"
            className="field crm-search-input"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            maxLength={120}
            autoComplete="off"
            placeholder={t("Search segments…")}
            title={t("Search by segment name or ID")}
          />
        </div>
        {canWrite && (
          <Button variant="primary" className="crm-list-create" onClick={onNew}>
            {t("New segment")}
          </Button>
        )}
      </div>
      {viewer.operator === null && (
        viewer.access === "unavailable" ? (
          // CAD-1193: a completed unanswered check is unavailable, not
          // still checking — the retry re-runs the real access probe.
          <Notice state="access-unavailable" onRetry={viewer.onRetryAccess} retryLabel={t("Retry access check")}>
            {t("Access could not be confirmed — the board's access check did not answer, so saved segments stay closed.")}
          </Notice>
        ) : (
          <Notice>{t("Checking whether this session may inspect saved segments…")}</Notice>
        )
      )}
      {viewer.operator === false && (
        <Notice>{t("Sign in as the operator to inspect saved segments.")}</Notice>
      )}
      {viewer.operator && viewer.readOnly && (
        <Notice state="read-only">{t("Read-only view. Segment creation and edits are unavailable.")}</Notice>
      )}
      {viewer.operator && loading && (
        <Loading>{t("Reading segments…")}</Loading>
      )}
      {viewer.operator && error !== null && !loading && (
        <ErrorNotice onRetry={() => void queryState.store.refresh()}>{error}</ErrorNotice>
      )}
      {viewer.operator && error === null && !loading && segments.length === 0 && (
        <EmptyState name="segments" title={t("No segments yet")}>
          {t("Create the first saved rule with New segment. Only real server rows appear here.")}
        </EmptyState>
      )}
      <span role="status"><QueryRefresh updating={queryState.updating} /></span>
      {viewer.operator && shown.length > 0 && (
        <div
          className="crm-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={t("Segments table — scroll horizontally to reach every column")}
        >
          <table className="crm-table">
            <thead>
              <tr>
                <th scope="col">{t("Name")}</th>
                <th scope="col">{t("Rule")}</th>
                <th scope="col">{t("Matches")}</th>
                <th scope="col">{t("Can be emailed")}</th>
                <th scope="col">
                  <span className="sr-only">{t("Open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((segment) => (
                <tr
                  key={segment.id}
                  data-record-id={segment.id}
                  className="crm-row-open"
                  onClick={(e) => {
                    // A click on a control inside the row keeps its own meaning.
                    if ((e.target as HTMLElement).closest("button, input, a")) return;
                    onSelect(segment.id);
                  }}
                >
                  <td className="text-ink-100">
                    {segment.name}
                    <span className="num text-micro text-ink-500"> · {segment.id}</span>
                  </td>
                  <td className="text-ink-300">
                    <span className="chip">{segment.predicates[0] ? describeRule(segment.predicates[0], t) : "—"}</span>
                    {segment.predicates.length > 1 && (
                      <span className="num text-micro text-ink-500"> +{formatNumber(segment.predicates.length - 1)} {t("more")}</span>
                    )}
                  </td>
                  <td className="num text-ink-300">{counts[segment.id]?.baseCount ?? "—"}</td>
                  <td>
                    {counts[segment.id] ? (
                      <span className="chip" data-tone={counts[segment.id]!.finalCount === 0 ? "warn" : "ok"}>
                        {counts[segment.id]!.finalCount}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <button type="button" className="lnk" onClick={() => onSelect(segment.id)}>
                      {t("Open")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewer.operator && !loading && error === null && segments.length > 0 && (
        <>
          {filtered.length === 0 && <p role="status" className="text-label text-ink-400">{t("No segments match this search")}</p>}
          <ListPager
            page={currentPage}
            pageCount={pageCount}
            summary={t(pageCount > 1 ? "{shown} of {count} segments" : filtered.length === 1 ? "{count} segment" : "{count} segments").replace("{shown}", formatNumber(shown.length)).replace("{count}", formatNumber(filtered.length))}
            onPage={setPage}
            hasNext={currentPage + 1 < pageCount}
            busy={queryState.updating}
            label={t("Segment page")}
          />
        </>
      )}
    </section>
  );
}

export interface RuleDraft {
  field: string;
  op: string;
  value: string;
}

export function ruleHint(field: string): string {
  return SEGMENT_FIELDS.find((entry) => entry.value === field)?.hint ?? "";
}

function RuleRows({
  rules,
  disabled,
  onChange,
}: {
  rules: RuleDraft[];
  disabled: boolean;
  onChange: (rules: RuleDraft[]) => void;
}) {
  const { t, formatNumber } = useLocale();
  const set = (index: number, patch: Partial<RuleDraft>) => {
    onChange(rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)));
  };
  return (
    <ol className="crm-history" aria-label={t("Segment rules")}>
      {rules.map((rule, index) => (
        <li key={index} className="card px-3 py-3">
          <div className="crm-field-row">
            <Field label={`${t("Field")} ${formatNumber(index + 1)}`} id={`seg-rule-field-${index}`} className="crm-field">
              {(c) => (
                <Select
                  id={c.id}
                  value={rule.field}
                  onChange={(value) => isSegmentField(value) && set(index, { field: value })}
                  options={SEGMENT_FIELDS.map((entry) => ({ value: entry.value, label: t(entry.label) }))}
                  aria-label={`${t("Rule")} ${formatNumber(index + 1)} ${t("field")}`}
                  disabled={disabled}
                  full
                />
              )}
            </Field>
            <Field label={`${t("Operator")} ${formatNumber(index + 1)}`} id={`seg-rule-op-${index}`} className="crm-field">
              {(c) => (
                <Select
                  id={c.id}
                  value={rule.op}
                  onChange={(value) => isSegmentOp(value) && set(index, { op: value })}
                  options={SEGMENT_OPS.map((entry) => ({ value: entry.value, label: t(entry.label) }))}
                  aria-label={`${t("Rule")} ${formatNumber(index + 1)} ${t("operator")}`}
                  disabled={disabled}
                  full
                />
              )}
            </Field>
          </div>
          <Field
            label={`${t("Value")} ${formatNumber(index + 1)}`}
            id={`seg-rule-value-${index}`}
            hint={t(ruleHint(rule.field))}
            disabled={disabled}
            className="crm-field mt-2"
          >
            {(c) => (
              <input
                {...c}
                className="field"
                value={rule.value}
                onChange={(e) => set(index, { value: e.target.value })}
                maxLength={120}
                autoComplete="off"
                placeholder={rule.field === "consent_email" ? "granted" : rule.field === "email_domain" ? "example.com" : "vip"}
              />
            )}
          </Field>
          {rules.length > 1 && !disabled && (
            <p className="mt-2">
              <button
                type="button"
                className="lnk text-label"
                onClick={() => onChange(rules.filter((_, at) => at !== index))}
              >
                {t("Remove rule")}{formatNumber(index + 1)}
              </button>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function SegmentNew({
  scope,
  viewer,
  onCreated,
  onCancel,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  onCreated: (segmentId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const [name, setName] = useState("");
  const [rules, setRules] = useState<RuleDraft[]>([{ field: "tag", op: "eq", value: "" }]);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    headRef.current?.focus();
  }, []);
  return (
    <section aria-label={t("New segment")}>
      <h3 ref={headRef} className="text-cardtitle font-medium text-ink-100" tabIndex={-1} data-outlet-heading>
        {t("New segment")}
      </h3>
      <p className="text-label text-ink-400 mt-1">
        <button type="button" className="lnk" onClick={onCancel}>
          ← {t("Segments")}
        </button>
      </p>
      {!canWrite ? (
        <Notice className="mt-2" state="read-only">
          {t("Read-only view. A verified operator creates saved segments.")}
        </Notice>
      ) : (
        <form
          className="card px-4 py-4 mt-2 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            try {
              checkSegmentName(name);
              if (rules.length === 0 || rules.length > 8) {
                throw new ApiError("a segment needs 1 to 8 rules", 400);
              }
              for (const rule of rules) checkPredicate(rule.field, rule.op, rule.value);
            } catch (err: unknown) {
              setFormError(friendlyAudienceError(err));
              return;
            }
            setPending(true);
            void audienceClient
              .segmentSave(scope, {
                segmentId: newAudienceId("seg"),
                name,
                predicates: rules.map((rule) => ({ field: rule.field, op: rule.op, value: rule.value })),
              })
              .then((value) => onCreated(parseSegment(value).id))
              .catch((err: unknown) => setFormError(friendlyAudienceError(err)))
              .finally(() => setPending(false));
          }}
        >
          <Field label={t("Segment name")} id="seg-name" required className="crm-field">
            {(c) => (
              <input
                {...c}
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoComplete="off"
              />
            )}
          </Field>
          <RuleRows rules={rules} disabled={pending} onChange={setRules} />
          {rules.length < 8 && (
            <p>
              <button
                type="button"
                className="lnk text-label"
                disabled={pending}
                onClick={() => setRules((prev) => [...prev, { field: "tag", op: "eq", value: "" }])}
              >
                {t("+ Add rule (")}{rules.length}/8)
              </button>
            </p>
          )}
          {formError && <ErrorNotice bare>{t(formError)}</ErrorNotice>}
          <div>
            <Button type="submit" variant="primary" loading={pending} disabled={pending}>
              {t("Create segment")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function PreviewPanel({
  preview,
  loading,
  error,
  onRetry,
  label,
}: {
  preview: AudiencePreview | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  label: string;
}) {
  const { t, formatNumber } = useLocale();
  if (loading) {
    return (
      <p className="text-secondary text-ink-400" role="status">
        {t("Reading host audience counts…")}
      </p>
    );
  }
  if (error !== null) {
    return (
      <p className="card px-4 py-3 text-label text-fail border-fail/40" role="alert">
        {error}{" "}
        <button type="button" className="lnk" onClick={onRetry}>
          {t("Retry")}
        </button>
      </p>
    );
  }
  if (preview === null) return null;
  return (
    <div aria-label={t(label)}>
      <dl className="crm-detail">
        <div>
          <dt>{t("Base matches")}</dt>
          <dd className="num">{formatNumber(preview.baseCount)}</dd>
        </div>
        <div>
          <dt>{t("Saved exclusions")}</dt>
          <dd className="num">{formatNumber(preview.exclusionCount)}</dd>
        </div>
        <div>
          <dt>{t("Invalid address")}</dt>
          <dd className="num">{formatNumber(preview.excluded.invalid)}</dd>
        </div>
        <div>
          <dt>{t("No consent")}</dt>
          <dd className="num">{formatNumber(preview.excluded.noConsent)}</dd>
        </div>
        <div>
          <dt>{t("Unsubscribed")}</dt>
          <dd className="num">{formatNumber(preview.excluded.unsubscribed)}</dd>
        </div>
        <div>
          <dt>{t("Suppressed")}</dt>
          <dd className="num">{formatNumber(preview.excluded.suppressed)}</dd>
        </div>
        <div>
          <dt>{t("Final recipients")}</dt>
          <dd className="num">{formatNumber(preview.finalCount)}</dd>
        </div>
        <div>
          <dt>{t("Preview digest")}</dt>
          <dd className="num" title={t("Host audience digest")}>
            {preview.digest.slice(0, 18)}…
          </dd>
        </div>
      </dl>
      {preview.sample.length > 0 && (
        <section aria-label={t("Audience sample")} className="mt-3">
          <h4 className="text-label font-medium text-ink-200">
            {t("Sample (")}{preview.sample.length} {t("of")}{" "}{formatNumber(preview.finalCount)})
          </h4>
          <ol className="crm-history">
            {preview.sample.map((entry) => (
              <li key={entry.id} className="num text-label text-ink-300">
                {entry.displayName || "—"} · {entry.id}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function SegmentDrawer({
  scope,
  segmentId,
  viewer,
  canWrite,
  onClose,
  onOpen,
}: {
  scope: AudienceScope;
  segmentId: string;
  viewer: Viewer;
  canWrite: boolean;
  onClose: () => void;
  onOpen: (segmentId: string) => void;
}) {
  const { t, formatNumber } = useLocale();
  const queryState = useCrmQuery(scope, "segments.show", { segment_id: segmentId }, parseSegment);
  const { loading } = queryState;
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? queryState.error;
  const [editing, setEditing] = useState(false);
  const [editSegment, setEditSegment] = useState<SegmentDoc | null>(null);
  const segment = editing ? editSegment : queryState.data;
  const [editPending, setEditPending] = useState(false);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState(0);
  const [tab, setTab] = useState("overview");
  useEffect(() => { setEditing(false); setEditSegment(null); setActionError(null); setTab("overview"); }, [segmentId]);

  // Exact host preview counts for the saved rule: the same preview
  // action campaigns freeze from, never a client estimate.
  useEffect(() => {
    if (segment === null) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    setPreviewError(null);
    audienceClient
      .preview(scope, { mode: "segment", segmentId: segment.id })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(parsePreview(value));
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setPreviewError(friendlyAudienceError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment?.id, segment?.revision, previewToken]);

  const reload = () => { setActionError(null); void queryState.store.refresh(); };
  const ready = segment !== null;

  const members = preview?.sample ?? [];
  const funnel = preview ? eligibilityFunnel(preview, t) : null;
  const memberList = (rows: { id: string; displayName: string }[]) => (
    <ul className="crm-history" aria-label={t("Segment members")}>
      {rows.map((m) => (
        <li key={m.id} className="text-label text-ink-300">
          {m.displayName || "—"} <span className="chip" data-tone="ok">{t("Can email")}</span>
        </li>
      ))}
    </ul>
  );
  const tabs: DrawerTab[] =
    ready && segment !== null
      ? [
          {
            id: "overview",
            label: t("Overview"),
            panel: (
              <>
                <section className="crm-sect" aria-label={t("Segment rule")}>
                  <RuleSentence rules={segment.predicates} />
                </section>
                <section className="crm-sect" aria-label={t("Who can be emailed")}>
                  <h4>{t("Who can be emailed")}</h4>
                  {previewLoading && (
                    <p className="text-secondary text-ink-400" role="status">{t("Reading host audience counts…")}</p>
                  )}
                  {previewError !== null && (
                    <p className="card px-4 py-3 text-label text-fail border-fail/40" role="alert">
                      {previewError}{" "}
                      <button type="button" className="lnk" onClick={() => setPreviewToken((n) => n + 1)}>{t("Retry")}</button>
                    </p>
                  )}
                  {funnel && !previewLoading && previewError === null && (
                    <>
                      <ol className="crm-funnel" data-testid="funnel">
                        {funnel.steps.map((step) => (
                          <li key={step.label}>
                            <span>{step.label}</span>
                            <span className="crm-funnel-bar">
                              <span style={{ width: `${funnel.steps[0].count === 0 ? 0 : Math.round((step.count / funnel.steps[0].count) * 100)}%` }} />
                            </span>
                            <span className="num">{step.count}</span>
                          </li>
                        ))}
                      </ol>
                      {funnel.reason !== null && (
                        <p className="text-label text-ink-300 mt-1" data-testid="funnel-reason">{funnel.reason}</p>
                      )}
                    </>
                  )}
                </section>
                <section className="crm-sect" aria-label={t("Members preview")}>
                  <h4>{t("Members who can be emailed")}</h4>
                  {members.length === 0 && !previewLoading && (
                    <p className="text-secondary text-ink-400">{t("No one can be emailed from this segment yet.")}</p>
                  )}
                  {memberList(members.slice(0, 10))}
                  {members.length > 0 && (
                    <button type="button" className="lnk text-label" onClick={() => setTab("members")}>{t("View members")}</button>
                  )}
                </section>
              </>
            ),
          },
          {
            id: "members",
            label: t("Members"),
            panel: (
              <section className="crm-sect" aria-label={t("All members")}>
                <p className="text-label text-ink-400">
                  {t("Showing")}{" "}
                  {formatNumber(members.length)} {t("of")}{" "}
                  {formatNumber(preview?.finalCount ?? 0)}{" "}
                  {t((preview?.finalCount ?? 0) === 1 ? "customer who can be emailed." : "customers who can be emailed.")}
                </p>
                {memberList(members)}
              </section>
            ),
          },
          {
            id: "details",
            label: t("Details"),
            panel: (
              <section className="crm-sect" aria-label={t("Record diagnostics")}>
                <p className="num text-micro text-ink-500">
                  {t("Segment")} <span className="num">{segmentId}</span> · {t("revision")} r{segment.revision} · {t("digest")}{" "}
                  {segment.digest.slice(0, 18)}…
                </p>
                <div className="crm-sect">
                  <PreviewPanel
                    preview={preview}
                    loading={previewLoading}
                    error={previewError}
                    onRetry={() => setPreviewToken((count) => count + 1)}
                    label={t("Current matches")}
                  />
                </div>
              </section>
            ),
          },
        ]
      : [];

  const duplicate = () => {
    if (segment === null) return;
    setActionError(null);
    void audienceClient
      .segmentSave(scope, {
        segmentId: newAudienceId("seg"),
        name: `${segment.name} (copy)`.slice(0, 80),
        predicates: segment.predicates.map((r) => ({ field: r.field, op: r.op, value: r.value })),
      })
      .then((value) => onOpen(parseSegment(value).id))
      .catch((err: unknown) => setActionError(friendlyAudienceError(err)));
  };
  const useInCampaign = () => {
    void patchRoute({ section: "campaigns", view: "new", segment_id: segmentId, record_id: null });
  };

  return (
    <DrawerShell
      geometry={{ left: 0 }}
      kind="segment"
      label={t("Segment details")}
      title={loading ? t("Segment details") : (segment?.name ?? t("Segment details"))}
      avatar="◎"
      subtitle={segment ? `${segment.predicates.length} rule${segment.predicates.length === 1 ? "" : "s"}` : undefined}
      pills={
        ready && preview ? (
          <>
            <span className="chip">{preview.baseCount} {t("match")}</span>
            <span className="chip" data-tone={preview.finalCount === 0 ? "warn" : "ok"}>
              {preview.finalCount} {t("can be emailed")}
            </span>
          </>
        ) : undefined
      }
      tabs={tabs}
      tab={tab}
      onTab={setTab}
      secondary={
        ready ? (
          <>
            <Button size="sm" onClick={duplicate} disabled={!canWrite} title={canWrite ? undefined : t("Operators only")}>
              {t("Duplicate")}
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={() => { setEditSegment(segment); setEditing(true); }}>
                {t("Edit rules")}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
      state={
        loading ? (
          <p className="text-secondary text-ink-400" role="status">
            {t("Reading the segment…")}
          </p>
        ) : error !== null ? (
          <p className="card px-4 py-3 text-label text-fail border-fail/40" role="alert">
            {error}{" "}
            <button type="button" className="lnk" onClick={reload}>
              {t("Retry")}
            </button>
          </p>
        ) : queryState.updating ? <span role="status"><QueryRefresh updating /></span> : undefined
      }
      edit={
        editing && canWrite && ready && segment !== null
          ? {
              formId: "crm-segment-edit",
              title: t("Edit rules — saving is refused if the segment changed since you opened it"),
              pending: editPending,
              onCancel: () => setEditing(false),
              body: (
                <SegmentEdit
                  formId="crm-segment-edit"
                  scope={scope}
                  segment={segment}
                  onPending={setEditPending}
                  onSaved={(next) => {
                    queryState.store.write(() => next);
                    setEditing(false);
                  }}
                />
              ),
            }
          : null
      }
      primary={
        ready && canWrite ? (
          <Button size="sm" variant="primary" onClick={useInCampaign}>
            {t("Use in campaign")}
          </Button>
        ) : undefined
      }
      note={
        ready && !canWrite
          ? `Read-only view. ${viewer.operator ? "Edits are disabled on this board." : "Sign in as the operator to edit."}`
          : undefined
      }
      onClose={onClose}
    />
  );
}

function SegmentEdit({
  formId,
  scope,
  segment,
  onPending,
  onSaved,
}: {
  formId: string;
  scope: AudienceScope;
  segment: SegmentDoc;
  onPending: (pending: boolean) => void;
  onSaved: (segment: SegmentDoc) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(segment.name);
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    segment.predicates.map((rule) => ({ field: rule.field, op: rule.op, value: rule.value })),
  );
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <form
      id={formId}
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        try {
          checkSegmentName(name);
          if (rules.length === 0 || rules.length > 8) {
            throw new ApiError("a segment needs 1 to 8 rules", 400);
          }
          for (const rule of rules) checkPredicate(rule.field, rule.op, rule.value);
        } catch (err: unknown) {
          setFormError(friendlyAudienceError(err));
          return;
        }
        setPending(true);
        onPending(true);
        void audienceClient
          .segmentSave(scope, {
            segmentId: segment.id,
            name,
            predicates: rules.map((rule) => ({ field: rule.field, op: rule.op, value: rule.value })),
            expectedRevision: segment.revision,
          })
          .then((value) => onSaved(parseSegment(value)))
          .catch((err: unknown) => setFormError(friendlyAudienceError(err)))
          .finally(() => {
            setPending(false);
            onPending(false);
          });
      }}
    >
      <Field label={t("Segment name")} id="seg-edit-name" required disabled={pending} className="crm-field">
        {(c) => (
          <input
            {...c}
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="off"
          />
        )}
      </Field>
      <RuleRows rules={rules} disabled={pending} onChange={setRules} />
      {rules.length < 8 && (
        <p>
          <button
            type="button"
            className="lnk text-label"
            disabled={pending}
            onClick={() => setRules((prev) => [...prev, { field: "tag", op: "eq", value: "" }])}
          >
            {t("+ Add rule (")}{rules.length}/8)
          </button>
        </p>
      )}
      {formError && (
        <ErrorNotice bare>
          {t(formError)} {t("If another operator saved first, close and reopen to review their rules before retrying.")}
        </ErrorNotice>
      )}
    </form>
  );
}
