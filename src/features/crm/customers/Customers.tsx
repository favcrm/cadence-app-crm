import { useLocale } from "../locale";
import { ApiError,Button,DataTable,Detail,DrawerShell,EmptyState,ErrorNotice,Field,Loading,Notice,Select,type DrawerTab } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import { onScopeRetired } from "../../../bridge/scope";
import { useSurface } from "../../../bridge/presentation";
import { readCustomerList,useListMemory } from "../listMemory";
import ListPager, { LIST_PAGE_SIZE } from "../ListPager";
import {
activityItems,
buildConsentChange,
buildCreateProvenance,
buildCustomerProfile,
CONSENT_METHODS,
CONSENT_NOTE_MAX,
consentLabel,
EMPTY_CUSTOMER_FORM,
formFromProfile,
friendlyError,
isConsentChoice,
newCustomerId,
viewProfile,
type ConsentSetting,
type CustomerFormFields,
} from "../customerProfile";
import { QueryRefresh,useCrmQuery } from "../resources";
import { hostActions,parseRecord,parseRecordList,type ConsentMethod,type ConsentProvenance,type HostRecord,type HostScope } from "../hostActions";
import type { Viewer } from "../viewer";

/**
 * The CRM workspace inside the trusted shared App shell (CAD-781
 * Customers, CAD-784 Segments and Campaigns). Every section renders
 * server rows only, with a separate New page and direct detail
 * routes — no sample rows anywhere. The outlet remounts on every
 * install/context switch (the shell keys it on scope), so no search
 * text, page cursor or unsaved draft survives the boundary. The
 * nested section itself lives in the route (`crm=`), so direct links
 * and browser back keep it; switching sections clears the record
 * view in the shell. Bounded list selectors/scroll survive same-scope
 * navigation in frame memory only; the route never holds record content.
 *
 * The shell's own header row is the single Apps → App breadcrumb and
 * title; each section renders its own real heading instead of a
 * second crumb (CAD-863 release correction).
 */
export default function Customers({
  scope,
  viewer,
  view,
  recordId,
  onView,
  onSelect,
  onRecordCreated,
}: {
  scope: HostScope;
  /** CAD-813: the operator's newest chat message daemon-stamped with
   *  this scope — passed through to Campaigns untouched. */
  viewer: Viewer;
  view: "list" | "new";
  recordId: string | null;
  onView: (view: "list" | "new") => void;
  onSelect: (recordId: string | null) => void;
  onRecordCreated?: (recordId: string) => void;
}) {
  const canWrite = viewer.operator === true && !viewer.readOnly;
  // While the host's independent overlay is modal the list behind it is
  // inert, not merely covered, so keyboard focus stays in the detail.
  const hostModal = useSurface().modal;
  // Section navigation lives in the host-owned outlet submenu
  // (CrmOutlet): this pane only renders the active section body.
  return (
    <div className="app-outlet crm" data-outlet="crm">

      <div className="crm-surface" inert={hostModal}>
        {view === "list" && (
          <CustomerList
            scope={scope}
            viewer={viewer}
            onSelect={onSelect}
            onNew={() => onView("new")}
          />
        )}
        {view === "new" && (
          <CustomerNew
            scope={scope}
            viewer={viewer}
            onCreated={(id) => {
              // Prefer the shell's atomic landing; the two-step fallback
              // is only for hosts without it (and keeps stale `appview=new`).
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
        <CustomerDrawer
          scope={scope}
          recordId={recordId}
          viewer={viewer}
          canWrite={canWrite}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  );
}

const NO_RECORDS: HostRecord[] = [];

function CustomerList({
  scope,
  viewer,
  onSelect,
  onNew,
}: {
  scope: HostScope;
  viewer: Viewer;
  onSelect: (recordId: string) => void;
  onNew: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const [initialList] = useState(() => readCustomerList(scope));
  const [query, setQuery] = useState(initialList?.query ?? "");
  const [committed, setCommitted] = useState(initialList?.committed ?? "");
  const [cursors, setCursors] = useState<string[]>(initialList?.cursors ?? []);
  const [page, setPage] = useState(initialList?.page ?? 0);
  const cursor = page > 0 ? cursors[page - 1] : undefined;
  const queryState = useCrmQuery(scope, "records.list", { query: committed || undefined, limit: LIST_PAGE_SIZE, cursor }, parseRecordList);
  const records = queryState.data?.records ?? NO_RECORDS;
  const truncated = queryState.data?.truncated ?? false;
  const nextCursor = queryState.data?.nextCursor ?? null;
  const { loading, error } = queryState;
  const pagingBusy = loading || queryState.updating || query.trim() !== committed;
  // Filters and selection act on the rows already read (this page);
  // the server search stays the only whole-list narrowing.
  const [consentFilter, setConsentFilter] = useState(initialList?.consentFilter ?? "");
  const [sourceFilter, setSourceFilter] = useState(initialList?.sourceFilter ?? "");
  const [tagFilter, setTagFilter] = useState(initialList?.tagFilter ?? "");
  const listRef = useListMemory(scope, "customers", viewer.operator === true && queryState.data !== null,
    queryState.failure, { query, committed, cursors, page, consentFilter, sourceFilter, tagFilter },
    JSON.stringify([committed, cursor, consentFilter, sourceFilter, tagFilter]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sources = Array.from(
    new Set(records.map((r) => viewProfile(r.profile).source).filter((v): v is string => v !== null)),
  ).sort();
  const shown = records.filter((r) => {
    const v = viewProfile(r.profile);
    return (
      (consentFilter === "" || v.consentEmail === consentFilter) &&
      (sourceFilter === "" || v.source === sourceFilter) &&
      (tagFilter === "" || v.tags.includes(tagFilter))
    );
  });
  // Selection never outlives the rows it named.
  useEffect(() => {
    setSelected(new Set());
  }, [records]);

  // A changed server boundary invalidates later discovered pages, not
  // the current page or its predecessors. Never derive pages from totals.
  useEffect(() => {
    if (loading || queryState.updating || error !== null || queryState.data === null) return;
    if (cursors.length > page && (!truncated || nextCursor !== cursors[page])) {
      setCursors((known) => known.slice(0, page));
    }
  }, [page, cursors, truncated, nextCursor, loading, queryState.updating, queryState.data, error]);

  // Debounced search: typing never navigates, so no customer content
  // reaches the URL, history or session storage.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim();
      // Mounting a restored search must not erase its restored page. A pending
      // query/committed difference still finishes its ordinary debounce.
      if (next !== committed) {
        setCursors([]);
        setPage(0);
        setCommitted(next);
      }
    }, 250);
    const unsubscribe = onScopeRetired(() => clearTimeout(timer));
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [query, committed]);

  useEffect(() => {
    if (viewer.operator !== true || (queryState.failure instanceof ApiError && [401, 403].includes(queryState.failure.status))) {
      setQuery(""); setCommitted(""); setCursors([]); setPage(0);
      setConsentFilter(""); setSourceFilter(""); setTagFilter("");
      setSelected(new Set());
    }
  }, [viewer.operator, queryState.failure]);


  return (
    <section ref={listRef} aria-label={t("Customers list")} className="crm-list crm-list-controls">
      <h3 className="text-cardtitle font-medium text-ink-100" data-outlet-heading>
        {t("Customers")}
      </h3>
      <div className="crm-toolbar crm-list-toolbar">
        <div className="crm-search">
          <label className="sr-only" htmlFor="crm-customer-search">
            {t("Search customers")}
          </label>
          <input
            id="crm-customer-search"
            className="field crm-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={t("Search customers…")}
            title={t("Search by name, email or tag")}
          />
        </div>
        {viewer.operator === true && (
          <div className="crm-filters" role="group" aria-label={t("Filter customers on this page")}>
            <Select
              value={consentFilter}
              onChange={setConsentFilter}
              options={[
                { value: "", label: t("Email consent: any") },
                { value: "granted", label: "Granted" },
                { value: "unknown", label: "Unknown" },
                { value: "denied", label: "Withdrawn" },
              ]}
              aria-label={t("Filter by email consent")}
            />
            <Select
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[{ value: "", label: t("Source: any") }, ...sources.map((v) => ({ value: v, label: v }))]}
              aria-label={t("Filter by source")}
            />
            {tagFilter !== "" && (
              <button type="button" className="chip crm-chip-on" onClick={() => setTagFilter("")} aria-label={t("Clear tag filter {tag}").replace("{tag}", () => tagFilter)}>
                {t("tag")}: {tagFilter} ✕
              </button>
            )}
          </div>
        )}
        {canWrite && (
          <Button variant="primary" className="crm-list-create" onClick={onNew}>
            {t("New customer")}
          </Button>
        )}
      </div>
      {viewer.operator === null && (
        viewer.access === "unavailable" ? (
          // CAD-1193: a completed unanswered check is unavailable, not
          // still checking — the retry re-runs the real access probe.
          <Notice state="access-unavailable" onRetry={viewer.onRetryAccess} retryLabel={t("Retry access check")}>
            {t("Access could not be confirmed — the board's access check did not answer, so customer records stay closed.")}
          </Notice>
        ) : (
          <Notice>{t("Checking whether this session may inspect customer records…")}</Notice>
        )
      )}
      {viewer.operator === false && (
        <Notice>{t("Sign in as the operator to inspect customer records.")}</Notice>
      )}
      {viewer.operator && viewer.readOnly && (
        <Notice state="read-only">{t("Read-only view. Record creation and edits are unavailable.")}</Notice>
      )}
      {viewer.operator && loading && (
        <Loading>{t("Reading customers…")}</Loading>
      )}
      {viewer.operator && error !== null && !loading && (
        <ErrorNotice onRetry={() => void queryState.store.refresh()}>{error}</ErrorNotice>
      )}
      {viewer.operator && error === null && !loading && records.length === 0 && (
        <EmptyState
          name="customers"
          title={t(committed === "" ? "No customers yet" : "No customers match this search")}
        >
          {committed === ""
            ? t("Create the first record with New customer. Only real server rows appear here.")
            : t("Clear the search to see every record.")}
        </EmptyState>
      )}
      <span role="status"><QueryRefresh updating={queryState.updating} /></span>
      {viewer.operator && (records.length > 0 || page > 0) && (
        <>
          {selected.size > 0 && (
            <p className="crm-selection text-label text-ink-300" role="status">
              {formatNumber(selected.size)} {t("selected")}{" "}
              <button type="button" className="lnk" onClick={() => setSelected(new Set())}>
                {t("Clear")}
              </button>
            </p>
          )}
          {shown.length === 0 && (
            <EmptyState name="customers" title={t("No customers on this page match the filters")}>
              {t("Clear a filter to see this page's rows again.")}
            </EmptyState>
          )}
          {shown.length > 0 && (
          <DataTable<HostRecord>
            label={t("Customers table — scroll horizontally to reach every column")}
            wrapClassName="crm-table-wrap"
            tableClassName="crm-table"
            rowKey={(record) => record.id}
            rowProps={(record) => ({
              "data-record-id": record.id,
              className: "crm-row-open",
              onClick: (e: { target: EventTarget }) => {
                // A click on a control inside the row keeps its own meaning.
                if ((e.target as HTMLElement).closest("button, input, a")) return;
                onSelect(record.id);
              },
            })}
            columns={[
              {
                key: "select",
                header: (
                  <input
                    type="checkbox"
                    aria-label={t("Select all customers on this page")}
                    checked={shown.length > 0 && shown.every((r) => selected.has(r.id))}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())
                    }
                  />
                ),
                cell: (record) => (
                  <input
                    type="checkbox"
                    aria-label={`${t("Select")} ${viewProfile(record.profile).displayName}`}
                    checked={selected.has(record.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(record.id);
                        else next.delete(record.id);
                        return next;
                      })
                    }
                  />
                ),
              },
              {
                key: "name",
                header: t("Name"),
                cellClassName: "text-ink-100",
                cell: (record) => (
                  <button type="button" className="lnk" onClick={() => onSelect(record.id)}>
                    {viewProfile(record.profile).displayName}
                  </button>
                ),
              },
              {
                key: "email",
                header: t("Email"),
                cellClassName: "num text-ink-300 crm-nowrap",
                cell: (record) => viewProfile(record.profile).email ?? "—",
              },
              {
                key: "tags",
                header: t("Tags"),
                cell: (record) => {
                  const tags = viewProfile(record.profile).tags;
                  return tags.length > 0 ? (
                    <span className="crm-chips">
                      {tags.map((tag) => (
                        <button key={tag} type="button" className="chip" title={`${t("Filter by tag")} ${tag}`} onClick={() => setTagFilter(tag)}>
                          {tag}
                        </button>
                      ))}
                    </span>
                  ) : (
                    "—"
                  );
                },
              },
              {
                key: "source",
                header: t("Source"),
                cellClassName: "text-ink-300",
                cell: (record) => viewProfile(record.profile).source ?? "—",
              },
              {
                key: "consent",
                header: t("Email consent"),
                cell: (record) => {
                  const state = viewProfile(record.profile).consentEmail;
                  return (
                    <span className={`chip ${state === "granted" ? "crm-consent-ok" : ""}`} title={t("Email consent")}>
                      {consentLabel(state)}
                    </span>
                  );
                },
              },
            ]}
            rows={shown}
          />
          )}
          <ListPager
            page={page}
            pageCount={cursors.length + 1}
            summary={(shown.length === records.length
              ? t(records.length === 1 ? "{count} customer on this page" : "{count} customers on this page")
              : t("{shown} of {count} customers on this page"))
              .replace("{shown}", formatNumber(shown.length))
              .replace("{count}", formatNumber(records.length))}
            onPage={setPage}
            onNext={() => {
              if (nextCursor === null) return;
              if (cursors[page] !== nextCursor) {
                setCursors((known) => [...known.slice(0, page), nextCursor]);
              }
              setPage((current) => current + 1);
            }}
            hasNext={truncated && nextCursor !== null}
            busy={pagingBusy}
            label={t("Customer page")}
            visitedOnly
          />
        </>
      )}
    </section>
  );
}

const CONSENT_OPTIONS: { value: string; label: string }[] = [
  { value: "unknown", label: "Unknown" },
  { value: "granted", label: "Granted" },
  { value: "denied", label: "Denied" },
];

function CustomerForm({
  initial,
  submitLabel,
  pending,
  formError,
  formId,
  hideConsent,
  consentMethod,
  onSubmit,
}: {
  initial: CustomerFormFields;
  /** Create only: optional "How was consent given?" when a channel is Granted. */
  consentMethod?: boolean;
  submitLabel: string;
  /** Set when a drawer footer owns the Save button; the form then has none. */
  formId?: string;
  /** Edit hides consent: it changes only through Record consent, with provenance. */
  hideConsent?: boolean;
  pending: boolean;
  formError: string | null;
  onSubmit: (fields: CustomerFormFields, provenance: ConsentProvenance | null) => void;
}) {
  const { t } = useLocale();
  const [fields, setFields] = useState<CustomerFormFields>(initial);
  const [method, setMethod] = useState<ConsentMethod | "">("");
  const [note, setNote] = useState("");
  const granted = fields.consentEmail === "granted" || fields.consentSms === "granted";
  const [fieldError, setFieldError] = useState<string | null>(null);
  const set = (patch: Partial<CustomerFormFields>) => {
    setFields((prev) => ({ ...prev, ...patch }));
    setFieldError(null);
  };
  return (
    <form
      id={formId}
      className={formId ? "grid gap-3" : "card px-4 py-4 grid gap-3"}
      onSubmit={(e) => {
        e.preventDefault();
        let provenance: ConsentProvenance | null = null;
        try {
          buildCustomerProfile(fields);
          if (consentMethod && granted) provenance = buildCreateProvenance(method, note);
        } catch (e: unknown) {
          setFieldError(e instanceof ApiError ? e.message : String(e));
          return;
        }
        onSubmit(fields, provenance);
      }}
    >
      <Field label={t("Display name")} id="crm-display-name" required className="crm-field">
        {(c) => (
          <input
            {...c}
            className="field"
            value={fields.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            maxLength={120}
            autoComplete="off"
          />
        )}
      </Field>
      <div className="crm-field-row">
        <Field label={t("Email (optional)")} id="crm-email" className="crm-field">
          {(c) => (
            <input
              {...c}
              className="field"
              type="email"
              value={fields.email}
              onChange={(e) => set({ email: e.target.value })}
              maxLength={254}
              autoComplete="off"
              placeholder={t("name@example.com")}
            />
          )}
        </Field>
        <Field label={t("Phone (optional)")} id="crm-phone" className="crm-field">
          {(c) => (
            <input
              {...c}
              className="field"
              type="tel"
              value={fields.phone}
              onChange={(e) => set({ phone: e.target.value })}
              maxLength={24}
              autoComplete="off"
            />
          )}
        </Field>
      </div>
      <div className="crm-field-row">
        <Field label={t("Tags (optional)")} id="crm-tags" hint={t("Comma separated")} className="crm-field">
          {(c) => (
            <input
              {...c}
              className="field"
              value={fields.tags}
              onChange={(e) => set({ tags: e.target.value })}
              maxLength={400}
              autoComplete="off"
              placeholder={t("vip, newsletter")}
            />
          )}
        </Field>
        <Field label={t("Source (optional)")} id="crm-source" className="crm-field">
          {(c) => (
            <input
              {...c}
              className="field"
              value={fields.source}
              onChange={(e) => set({ source: e.target.value })}
              maxLength={40}
              autoComplete="off"
              placeholder={t("import")}
            />
          )}
        </Field>
      </div>
      {!hideConsent && (
      <div className="crm-field-row">
        <Field label={t("Email consent (explicit)")} id="crm-consent-email" hint={t("No marketing until granted")} className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={fields.consentEmail}
              onChange={(value) => isConsentChoice(value) && set({ consentEmail: value })}
              options={CONSENT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
              aria-label={t("Email consent")}
              full
            />
          )}
        </Field>
        <Field label={t("SMS consent (explicit)")} id="crm-consent-sms" hint={t("No marketing until granted")} className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={fields.consentSms}
              onChange={(value) => isConsentChoice(value) && set({ consentSms: value })}
              options={CONSENT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
              aria-label={t("SMS consent")}
              full
            />
          )}
        </Field>
      </div>
      )}
      {!hideConsent && consentMethod && granted && (
        <div className="crm-field-row" data-testid="create-consent-method">
          <Field label={t("How was consent given? (optional)")} id="crm-create-method" className="crm-field">
            {(c) => (
              <Select
                id={c.id}
                value={method}
                onChange={(v) => { setMethod(v as ConsentMethod | ""); setFieldError(null); }}
                options={[{ value: "", label: t("Not recorded") }, ...CONSENT_METHODS.map((option) => ({ ...option, label: t(option.label) }))]}
                aria-label={t("How consent was given")}
                full
              />
            )}
          </Field>
          {method !== "" && (
            <Field label={t("Note (optional)")} id="crm-create-note" className="crm-field">
              {(c) => (
                <input
                  {...c}
                  className="field"
                  value={note}
                  onChange={(e) => { setNote(e.target.value); setFieldError(null); }}
                  maxLength={CONSENT_NOTE_MAX}
                  autoComplete="off"
                />
              )}
            </Field>
          )}
        </div>
      )}
      {(fieldError ?? formError) && (
        <ErrorNotice bare>{fieldError ?? formError}</ErrorNotice>
      )}
      {formId === undefined && (
        <div>
          <Button type="submit" variant="primary" loading={pending} disabled={pending}>
            {t(submitLabel)}
          </Button>
        </div>
      )}
    </form>
  );
}

const CONSENT_SETTINGS: { value: string; label: string }[] = [
  { value: "granted", label: "Granted" },
  { value: "unknown", label: "Unknown" },
  { value: "denied", label: "Withdrawn" },
];

function asSetting(value: string | null): ConsentSetting {
  return value === "granted" || value === "denied" ? value : "unknown";
}

/** Record consent: Email/SMS status, how it was given, optional note. */
function ConsentForm({
  profile,
  formId,
  formError,
  onSubmit,
}: {
  profile: unknown;
  formId: string;
  formError: string | null;
  onSubmit: (change: ReturnType<typeof buildConsentChange>) => void;
}) {
  const { t } = useLocale();
  const current = viewProfile(profile);
  const [email, setEmail] = useState<ConsentSetting>(asSetting(current.consentEmail));
  const [sms, setSms] = useState<ConsentSetting>(asSetting(current.consentSms));
  const [method, setMethod] = useState<ConsentMethod | "">("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const granting =
    (email === "granted" && current.consentEmail !== "granted") ||
    (sms === "granted" && current.consentSms !== "granted");
  return (
    <form
      id={formId}
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSubmit(buildConsentChange(profile, { email, sms, method: granting ? method : "", note }));
        } catch (error: unknown) {
          setFieldError(error instanceof ApiError ? error.message : String(error));
        }
      }}
    >
      <div className="crm-field-row">
        <Field label={t("Email marketing")} id="crm-rc-email" className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={email}
              onChange={(v) => { setEmail(asSetting(v)); setFieldError(null); }}
              options={CONSENT_SETTINGS}
              aria-label={t("Email marketing consent")}
              full
            />
          )}
        </Field>
        <Field label={t("SMS marketing")} id="crm-rc-sms" className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={sms}
              onChange={(v) => { setSms(asSetting(v)); setFieldError(null); }}
              options={CONSENT_SETTINGS}
              aria-label={t("SMS marketing consent")}
              full
            />
          )}
        </Field>
      </div>
      {granting && (
        <Field label={t("How was it given?")} id="crm-rc-method" hint={t("Kept in the customer's activity for audit")} className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={method}
              onChange={(v) => { setMethod(v as ConsentMethod | ""); setFieldError(null); }}
              options={[{ value: "", label: t("Choose…") }, ...CONSENT_METHODS.map((option) => ({ ...option, label: t(option.label) }))]}
              aria-label={t("How consent was given")}
              full
            />
          )}
        </Field>
      )}
      <Field label={t("Note (optional)")} id="crm-rc-note" className="crm-field">
        {(c) => (
          <input
            {...c}
            className="field"
            value={note}
            onChange={(e) => { setNote(e.target.value); setFieldError(null); }}
            maxLength={CONSENT_NOTE_MAX}
            autoComplete="off"
            placeholder={t("e.g. Signed at the counter, 2 Oct")}
          />
        )}
      </Field>
      {(fieldError ?? formError) && <ErrorNotice bare>{fieldError ?? formError}</ErrorNotice>}
    </form>
  );
}

function CustomerNew({
  scope,
  viewer,
  onCreated,
  onCancel,
}: {
  scope: HostScope;
  viewer: Viewer;
  onCreated: (recordId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Keyboard users land on the heading when the route changes.
  useEffect(() => {
    headRef.current?.focus();
  }, []);
  return (
    <section aria-label={t("New customer")}>
      <h3 ref={headRef} className="text-cardtitle font-medium text-ink-100" tabIndex={-1} data-outlet-heading>
        {t("New customer")}
      </h3>
      <p className="text-label text-ink-400 mt-1">
        <button type="button" className="lnk" onClick={onCancel}>
          ← {t("Customers")}
        </button>
      </p>
      {!canWrite ? (
        <Notice className="mt-2" state="read-only">
          {t("Read-only view. A verified operator creates customer records.")}
        </Notice>
      ) : (
        <div className="mt-2">
          <CustomerForm
            initial={EMPTY_CUSTOMER_FORM}
            submitLabel="Create customer"
            consentMethod
            pending={pending}
            formError={formError}
            onSubmit={(fields, provenance) => {
              setPending(true);
              setFormError(null);
              let profile: Record<string, unknown>;
              try {
                profile = buildCustomerProfile(fields);
              } catch (e: unknown) {
                setPending(false);
                setFormError(friendlyError(e));
                return;
              }
              void hostActions
                .create(scope, newCustomerId(), profile, provenance ?? undefined)
                .then((record) => onCreated(record.id))
                .catch((e: unknown) => setFormError(friendlyError(e)))
                .finally(() => setPending(false));
            }}
          />
        </div>
      )}
    </section>
  );
}

export function CustomerDrawer({
  scope,
  recordId,
  viewer,
  canWrite,
  onClose,
}: {
  scope: HostScope;
  recordId: string;
  viewer: Viewer;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { t, formatDate } = useLocale();
  const queryState = useCrmQuery(scope, "records.show", { record_id: recordId }, parseRecord);
  const { loading, error } = queryState;
  const [mode, setMode] = useState<"view" | "edit" | "consent">("view");
  const [editRecord, setEditRecord] = useState<HostRecord | null>(null);
  const record = mode === "view" ? queryState.data : editRecord;
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { setMode("view"); setEditRecord(null); setFormError(null); }, [recordId]);

  const view = record ? viewProfile(record.profile) : null;
  const timeline = record ? activityItems(record, t) : [];

  const initials = view
    ? view.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : "";
  const reload = () => { void queryState.store.refresh(); };
  const ready = record !== null && view !== null;

  const when = (at: number) => formatDate(at * 1000, { dateStyle: "medium" });
  const tabs: DrawerTab[] =
    ready && record !== null && view !== null
      ? [
          {
            id: "overview",
            label: t("Overview"),
            panel: (
              <>
                <section className="crm-sect" aria-label={t("Consent")}>
                  <h4>{t("Consent")}</h4>
                  <div className="crm-consent-cards">
                    <div className="card px-3 py-2" data-consent="email">
                      <div className="text-label text-ink-300">{t("Email marketing")}</div>
                      <span className={`chip ${view.consentEmail === "granted" ? "crm-consent-ok" : ""}`}>{t(consentLabel(view.consentEmail))}</span>
                      <div className="text-micro text-ink-500">
                        {t(view.consentEmail === "granted" ? "Can receive campaigns" : "No marketing until granted")}
                      </div>
                    </div>
                    <div className="card px-3 py-2" data-consent="sms">
                      <div className="text-label text-ink-300">{t("SMS marketing")}</div>
                      <span className={`chip ${view.consentSms === "granted" ? "crm-consent-ok" : ""}`}>{t(consentLabel(view.consentSms))}</span>
                      <div className="text-micro text-ink-500">{t(view.consentSms === null ? "Not recorded" : "Per customer choice")}</div>
                    </div>
                  </div>
                </section>
                <section className="crm-sect" aria-label={t("Profile")}>
                  <h4>{t("Profile")}</h4>
                  <Detail
                    className="crm-detail"
                    label={t("Customer fields")}
                    items={[
                      { key: "email", term: "Email", value: <span className="num">{view.email ?? "—"}</span> },
                      { key: "phone", term: "Phone", value: <span className="num">{view.phone ?? "—"}</span> },
                      { key: "tags", term: "Tags", value: view.tags.length > 0 ? view.tags.join(", ") : "—" },
                      { key: "source", term: "Source", value: view.source ?? "—" },
                    ]}
                  />
                </section>
              </>
            ),
          },
          {
            id: "activity",
            label: t("Activity"),
            panel:
              timeline.length > 0 ? (
                <ol className="crm-timeline" aria-label={t("Activity")}>
                  {timeline.map((item) => (
                    <li key={item.key}>
                      <span>{item.text}</span>
                      {item.note && <span className="text-micro text-ink-400"> — “{item.note}”</span>}
                      <div className="num text-micro text-ink-500">{when(item.at)}</div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-secondary text-ink-400">{t("No activity recorded yet.")}</p>
              ),
          },
          {
            id: "details",
            label: t("Details"),
            panel: (
              <section aria-label={t("Record diagnostics")}>
                <p className="text-micro text-ink-500 mb-2">
                  {t("Selection is chat context only — the server re-proves scope on every send.")}
                </p>
                <p className="num text-micro text-ink-500">
                  {t("Record")} <span className="num">{recordId}</span> · {t("revision")} r{record.revision} · {t("digest")}{" "}
                  {record.digest.slice(0, 18)}…
                </p>
              </section>
            ),
          },
        ]
      : [];

  const save = (profile: Record<string, unknown>, provenance?: { method: ConsentMethod; note?: string }) => {
    if (record === null) return;
    setPending(true);
    setFormError(null);
    void hostActions
      .update(scope, recordId, record.revision, profile, provenance)
      .then((next) => {
        queryState.store.write(() => next);
        setMode("view");
      })
      .catch((e: unknown) => setFormError(friendlyError(e)))
      .finally(() => setPending(false));
  };

  return (
    <DrawerShell
      geometry={{ left: 0 }}
      kind="customer"
      label={t("Customer details")}
      title={loading ? t("Customer details") : (view?.displayName ?? t("Customer details"))}
      avatar={initials || undefined}
      subtitle={view?.email ?? undefined}
      pills={
        view && ready ? (
          <>
            <span className="chip" title={t("Email consent")}>{t("Email")}: {t(consentLabel(view.consentEmail))}</span>
            <span className="chip" title={t("SMS consent")}>{t("SMS:")} {t(consentLabel(view.consentSms))}</span>
            {view.tags.map((tag) => (
              <span key={tag} className="chip">{tag}</span>
            ))}
          </>
        ) : undefined
      }
      tabs={tabs}
      state={
        loading ? (
          <Loading>{t("Reading the record…")}</Loading>
        ) : error !== null ? (
          <ErrorNotice onRetry={reload}>{error}</ErrorNotice>
        ) : queryState.updating ? <span role="status"><QueryRefresh updating /></span> : undefined
      }
      warning={
        ready && view !== null && view.consentEmail !== "granted" ? (
          <>
            <b>{view.displayName} {t("can't receive campaigns.")}</b>{" "}
            {view.consentEmail === "denied" ? t("Email consent was withdrawn.") : t("No email consent recorded.")}
          </>
        ) : undefined
      }
      edit={
        mode !== "view" && canWrite && ready && record !== null
          ? mode === "edit"
            ? {
                formId: "crm-customer-edit",
                title: "Edit profile — saving is refused if the record changed since you opened it",
                pending,
                onCancel: () => setMode("view"),
                body: (
                  <CustomerForm
                    key={record.revision}
                    formId="crm-customer-edit"
                    hideConsent
                    initial={formFromProfile(record.profile)}
                    submitLabel="Save changes"
                    pending={pending}
                    formError={formError}
                    onSubmit={(fields) => {
                      let profile: Record<string, unknown>;
                      try {
                        profile = buildCustomerProfile(fields);
                      } catch (e: unknown) {
                        setFormError(friendlyError(e));
                        return;
                      }
                      save(profile);
                    }}
                  />
                ),
              }
            : {
                formId: "crm-customer-consent",
                title: "Record consent",
                saveLabel: "Save consent",
                pending,
                onCancel: () => setMode("view"),
                body: (
                  <ConsentForm
                    key={record.revision}
                    formId="crm-customer-consent"
                    profile={record.profile}
                    formError={formError}
                    onSubmit={(change) => save(change.profile, change.provenance ?? undefined)}
                  />
                ),
              }
          : null
      }
      secondary={
        ready ? (
          <>
            {view?.email ? (
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(view.email ?? "")}>
                {t("Copy email")}
              </Button>
            ) : null}
            {canWrite ? (
              <Button size="sm" onClick={() => { setEditRecord(record); setMode("edit"); setFormError(null); }}>
                {t("Edit")}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
      primary={
        ready && canWrite ? (
          <Button size="sm" variant="primary" onClick={() => { setEditRecord(record); setMode("consent"); setFormError(null); }}>
            {t("Record consent")}
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
