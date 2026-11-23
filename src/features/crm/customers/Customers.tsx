import { useLocale } from "../locale";
import { ApiError,Button,DataTable,Detail,EmptyState,ErrorNotice,Field,Loading,Notice,Resource,Select,useQuery } from "@cadence/screen-ui";
import { useEffect,useRef,useState,type MouseEvent } from "react";
import FrameDrawer from "../FrameDrawer";
import ImportCsvDrawer from "./ImportCsvDrawer";
import MergeCustomerDrawer from "./MergeCustomerDrawer";
import WorkspaceTabs from "../WorkspaceTabs";
import { onScopeRetired } from "../../../bridge/scope";
import { readCustomerList,useListMemory } from "../listMemory";
import { hasParams,queryPatch,readQueryParams,type QueryParams } from "../../../domain/routeParams";
import { useRouteParams,useRouteParamSync } from "../useRouteParams";
import ListPager, { LIST_PAGE_SIZE } from "../ListPager";
import {
activityItems,
buildConsentChange,
buildCreateProvenance,
buildCustomerProfile,
changeCustomerContacts,
CONSENT_METHODS,
CONSENT_NOTE_MAX,
consentLabel,
EMPTY_CUSTOMER_FORM,
formFromProfile,
friendlyError,
isConsentChoice,
newCustomerId,
readCustomerContacts,
viewProfile,
type ConsentSetting,
type CustomerContactFields,
type CustomerFormFields,
} from "../customerProfile";
import { changeCustomerCustomFields, readCustomerCustomFields, type CustomerCustomFieldForm, type CustomerCustomFieldType } from "../customerCustomFields";
import { QueryRefresh,useCrmQuery } from "../resources";
import { isDefiniteCreateRefusal } from "../hostErrors";
import { appendHistoryPage,DEAL_STAGES,hostActions,parseRecordList,TOUCHPOINT_CHANNELS,type ConsentMethod,type ConsentProvenance,type CustomerNoteRecord,type DealRecord,type DealStage,type HostRecord,type HostScope,type TaskRecord,type TouchpointChannel,type TouchpointDirection,type TouchpointRecord } from "../hostActions";
import { canEditCustomer, type Viewer } from "../viewer";

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
  const listPane = useRef<HTMLDivElement>(null);
  const lastOpenRecord = useRef<string | null>(null);
  useEffect(() => {
    if (recordId !== null) {
      lastOpenRecord.current = recordId;
    } else if (lastOpenRecord.current !== null) {
      const id = lastOpenRecord.current;
      lastOpenRecord.current = null;
      const pane = listPane.current;
      const opener = pane?.querySelector<HTMLElement>(`[data-record-id="${CSS.escape(id)}"] button.lnk`);
      (opener ?? pane?.querySelector<HTMLElement>("[data-outlet-heading]"))?.focus();
    }
  }, [recordId]);
  // Section navigation lives in the host-owned outlet submenu
  // (CrmOutlet): this pane only renders the active section body.
  return (
    <div className="app-outlet crm" data-outlet="crm">

      <div className="crm-surface">
        {view === "list" && (
          <div ref={listPane} hidden={recordId !== null}>
            <CustomerList
              scope={scope}
              viewer={viewer}
              onSelect={onSelect}
              onNew={() => onView("new")}
            />
          </div>
        )}
        {view === "list" && recordId !== null && (
          <CustomerWorkspace
            key={recordId}
            scope={scope}
            recordId={recordId}
            viewer={viewer}
            onClose={() => onSelect(null)}
            onMerged={(targetId) => onSelect(targetId)}
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
  const canCreate = viewer.operator === true && (viewer.canCreate ?? !viewer.readOnly);
  // A declared view (customers {q}) opens the list searched; without params the list is as it was left.
  const routeParams = useRouteParams();
  const [initialList] = useState(() => hasParams(routeParams) ? null : readCustomerList(scope));
  const [initialParams] = useState(() => readQueryParams(routeParams));
  const [query, setQuery] = useState(initialList?.query ?? initialParams.q);
  const [committed, setCommitted] = useState(initialList?.committed ?? initialParams.q);
  const [cursors, setCursors] = useState<string[]>(initialList?.cursors ?? []);
  const [page, setPage] = useState(initialList?.page ?? 0);
  const cursor = page > 0 ? cursors[page - 1] : undefined;
  const queryState = useCrmQuery(scope, "records.list", { query: committed || undefined, limit: LIST_PAGE_SIZE, cursor }, parseRecordList);
  const records = queryState.data?.records ?? NO_RECORDS;
  const truncated = queryState.data?.truncated ?? false;
  const nextCursor = queryState.data?.nextCursor ?? null;
  const total = queryState.data?.total ?? null;
  const totalPages = total === null ? undefined : Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const { loading, error } = queryState;
  const pagingBusy = loading || queryState.updating || query.trim() !== committed;
  const [jumping, setJumping] = useState<number | null>(null);
  const [jumpError, setJumpError] = useState<string | null>(null);
  const jumpRef = useRef(0);
  useEffect(() => () => { jumpRef.current += 1; }, []);
  // A cursor list can only move forward in one-page reads. Selecting a page
  // whose cursor is unknown walks the chain from the furthest known page,
  // keeping every cursor it learns so a later jump is instant. The current
  // query and cursor list stay untouched until the walk succeeds.
  const jumpTo = async (target: number) => {
    if (target === page || target < 0 || (totalPages !== undefined && target >= totalPages) || pagingBusy || jumping !== null) return;
    if (target <= cursors.length) { setPage(target); return; }
    const id = ++jumpRef.current;
    setJumpError(null);
    setJumping(target);
    try {
      const known = cursors.slice();
      let cursor: string | null = null;
      let have = 0;
      if (known.length === page) {
        cursor = nextCursor;
        have = page + 1;
      } else {
        const last = known.length;
        const lastInput = known[last - 1];
        if (lastInput === undefined) throw new Error(t("Could not load that page."));
        const receipt = await hostActions.list(scope, { query: committed || undefined, limit: LIST_PAGE_SIZE, cursor: lastInput });
        if (jumpRef.current !== id) return;
        cursor = receipt.nextCursor;
        have = last + 1;
      }
      while (have <= target) {
        if (cursor === null) throw new Error(t("Could not load that page."));
        known[have - 1] = cursor;
        if (have === target) break;
        const receipt = await hostActions.list(scope, { query: committed || undefined, limit: LIST_PAGE_SIZE, cursor });
        if (jumpRef.current !== id) return;
        cursor = receipt.nextCursor;
        have += 1;
      }
      setCursors(known);
      setPage(target);
    } catch (e) {
      if (jumpRef.current !== id) return;
      setJumpError(e instanceof Error ? e.message : t("Could not load that page."));
    } finally {
      if (jumpRef.current === id) setJumping(null);
    }
  };
  // Filters and selection act on the rows already read (this page);
  // the server search stays the only whole-list narrowing.
  const [consentFilter, setConsentFilter] = useState(initialList?.consentFilter ?? "");
  const [tagFilter, setTagFilter] = useState(initialList?.tagFilter ?? "");
  useRouteParamSync<QueryParams>({ q: committed }, readQueryParams, queryPatch, (next) => {
    jumpRef.current += 1; setJumping(null);
    setQuery(next.q); setCommitted(next.q); setCursors([]); setPage(0);
  });
  const listRef = useListMemory(scope, "customers", viewer.operator === true && queryState.data !== null,
    queryState.failure, { query, committed, cursors, page, consentFilter, tagFilter },
    JSON.stringify([committed, cursor, consentFilter, tagFilter]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importBanner, setImportBanner] = useState<string | null>(null);
  const shown = records.filter((r) => {
    const v = viewProfile(r.profile);
    return (
      (consentFilter === "" || v.consentEmail === consentFilter) &&
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
        jumpRef.current += 1;
        setJumping(null);
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
      jumpRef.current += 1;
      setJumping(null);
      setQuery(""); setCommitted(""); setCursors([]); setPage(0);
      setConsentFilter(""); setTagFilter("");
      setSelected(new Set());
    }
  }, [viewer.operator, queryState.failure]);


  return (
    <section ref={listRef} aria-label={t("Customers list")} className="crm-list crm-list-controls">
      {!viewer.canvas && (
        <h3 tabIndex={-1} className="text-cardtitle font-medium text-ink-100" data-outlet-heading>
          {t("Customers")}
        </h3>
      )}
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
            {tagFilter !== "" && (
              <button type="button" className="chip crm-chip-on" onClick={() => setTagFilter("")} aria-label={t("Clear tag filter {tag}").replace("{tag}", () => tagFilter)}>
                {t("tag")}: {tagFilter} ✕
              </button>
            )}
          </div>
        )}
        {canCreate && (
          <div className="crm-list-actions">
            {!viewer.canvas && (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                {t("Import CSV")}
              </Button>
            )}
            <Button variant="primary" className="crm-list-create" onClick={onNew}>
              {t("New customer")}
            </Button>
          </div>
        )}
      </div>
      {importBanner && (
        <Notice>
          <span>{importBanner}</span>{" "}
          <button type="button" className="lnk" onClick={() => setImportBanner(null)}>
            {t("Dismiss")}
          </button>
        </Notice>
      )}
      {importOpen && (
        <ImportCsvDrawer
          scope={scope}
          onClose={() => setImportOpen(false)}
          onImported={(created) => {
            setImportOpen(false);
            setImportBanner(
              created === 1
                ? t("Imported 1 customer.")
                : t("Imported {count} customers.").replace("{count}", () => String(created)),
            );
            void queryState.store.refresh();
          }}
        />
      )}
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
        <Notice>{t("You do not have access to customer records.")}</Notice>
      )}
      {viewer.operator && !viewer.canvas && !canCreate && (
        <Notice state="read-only">{t("Creating customers is unavailable.")}</Notice>
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
            ? viewer.canvas ? t("Only real server rows appear here.") : t("Create the first record with New customer. Only real server rows appear here.")
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
            tableClassName="crm-table crm-customer-table"
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
                cellClassName: "text-ink-100 crm-cell-name",
                cell: (record) => (
                  <button type="button" className="lnk" title={viewProfile(record.profile).displayName} onClick={() => onSelect(record.id)}>
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
                    <>
                      <span className="crm-chips crm-tags-full">
                        {tags.map((tag) => (
                          <button key={tag} type="button" className="chip" title={`${t("Filter by tag")} ${tag}`} onClick={() => setTagFilter(tag)}>
                            {tag}
                          </button>
                        ))}
                      </span>
                      {/* Narrow frames show the count; the tags are in the record. */}
                      <span className="chip crm-tags-count" title={tags.join(", ")}>{formatNumber(tags.length)}</span>
                    </>
                  ) : (
                    "—"
                  );
                },
              },
              {
                key: "consent",
                header: t("Email consent"),
                cell: (record) => {
                  const state = viewProfile(record.profile).consentEmail;
                  return (
                    <span className={`chip ${state === "granted" ? "crm-consent-ok" : ""}`} title={t("Email consent")}>
                      {t(consentLabel(state))}
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
            pageCount={totalPages ?? cursors.length + 1}
            pendingPage={jumping ?? undefined}
            summary={jumping !== null
              ? t("Loading page {page}…").replace("{page}", formatNumber(jumping + 1))
              : (shown.length === records.length
                ? t(records.length === 1 ? "{count} customer on this page" : "{count} customers on this page")
                : t("{shown} of {count} customers on this page"))
                .replace("{shown}", formatNumber(shown.length))
                .replace("{count}", formatNumber(records.length))}
            onPage={jumpTo}
            hasNext={totalPages !== undefined ? page + 1 < totalPages : truncated && nextCursor !== null}
            busy={pagingBusy || jumping !== null}
            label={t("Customer page")}
          />
          {jumpError && <p className="text-micro text-ink-500" role="alert">{jumpError}</p>}
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
  submitBlocked = false,
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
  submitBlocked?: boolean;
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
        if (pending || submitBlocked) return;
        let provenance: ConsentProvenance | null = null;
        try {
          buildCustomerProfile(fields);
          if (consentMethod && granted) provenance = buildCreateProvenance(method, note);
        } catch (e: unknown) {
          setFieldError(e instanceof ApiError ? t(e.message) : String(e));
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
        <Field label={t("Customer type (optional)")} id="crm-customer-type" className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={fields.customerType}
              onChange={(value) => {
                if (value === "" || value === "person" || value === "organization") set({ customerType: value });
              }}
              options={[
                { value: "", label: t("Not specified") },
                { value: "person", label: t("Person") },
                { value: "organization", label: t("Organization") },
              ]}
              aria-label={t("Customer type")}
              full
            />
          )}
        </Field>
        <Field label={t("Website (optional)")} id="crm-website" className="crm-field">
          {(c) => (
            <input
              {...c}
              className="field"
              type="url"
              value={fields.website}
              onChange={(e) => set({ website: e.target.value })}
              maxLength={2048}
              autoComplete="off"
              placeholder="https://example.com"
            />
          )}
        </Field>
      </div>
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
          {(method !== "" || note !== "") && (
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
          <Button type="submit" variant="primary" loading={pending} disabled={pending || submitBlocked}>
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
          onSubmit(buildConsentChange(profile, { email, sms, method: granting || note.trim() !== "" ? method : "", note }));
        } catch (error: unknown) {
          setFieldError(error instanceof ApiError ? t(error.message) : String(error));
        }
      }}
    >
      <div className="crm-field-row">
        <Field label={t("Email marketing")} id="crm-rc-email" className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={email}
              onChange={(v) => { setEmail(asSetting(v)); setMethod(""); setFieldError(null); }}
              options={CONSENT_SETTINGS.map((option) => ({ ...option, label: t(option.label) }))}
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
              onChange={(v) => { setSms(asSetting(v)); setMethod(""); setFieldError(null); }}
              options={CONSENT_SETTINGS.map((option) => ({ ...option, label: t(option.label) }))}
              aria-label={t("SMS marketing consent")}
              full
            />
          )}
        </Field>
      </div>
      {(granting || note.trim() !== "") && (
        <Field label={t(granting ? "How was it given?" : "How was this recorded?")} id="crm-rc-method" hint={t("Kept in the customer's activity for audit")} className="crm-field">
          {(c) => (
            <Select
              id={c.id}
              value={method}
              onChange={(v) => { setMethod(v as ConsentMethod | ""); setFieldError(null); }}
              options={[{ value: "", label: t("Choose…") }, ...CONSENT_METHODS.map((option) => ({ ...option, label: t(option.label) }))]}
              aria-label={t(granting ? "How consent was given" : "How this was recorded")}
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

function ContactForm({
  initial,
  formId,
  formError,
  pending,
  onSubmit,
  onRemove,
}: {
  initial: CustomerContactFields;
  formId: string;
  formError: string | null;
  pending: boolean;
  onSubmit: (fields: CustomerContactFields) => void;
  onRemove?: () => void;
}) {
  const { t } = useLocale();
  const [fields, setFields] = useState(initial);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (patch: Partial<CustomerContactFields>) => setFields((current) => ({ ...current, ...patch }));
  return (
    <form id={formId} className="grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (!pending) onSubmit(fields);
    }}>
      <Field label={t("Contact name")} id="crm-contact-name" required className="crm-field">
        {(c) => <input {...c} className="field" value={fields.name} onChange={(event) => set({ name: event.target.value })} maxLength={120} autoComplete="off" />}
      </Field>
      <Field label={t("Job title (optional)")} id="crm-contact-title" className="crm-field">
        {(c) => <input {...c} className="field" value={fields.title} onChange={(event) => set({ title: event.target.value })} maxLength={120} autoComplete="off" />}
      </Field>
      <Field label={t("Email (optional)")} id="crm-contact-email" className="crm-field">
        {(c) => <input {...c} className="field" type="email" value={fields.email} onChange={(event) => set({ email: event.target.value })} maxLength={254} autoComplete="off" />}
      </Field>
      <Field label={t("Phone (optional)")} id="crm-contact-phone" className="crm-field">
        {(c) => <input {...c} className="field" type="tel" value={fields.phone} onChange={(event) => set({ phone: event.target.value })} maxLength={24} autoComplete="off" />}
      </Field>
      <p className="text-micro text-ink-500">{t("Contacts share this customer's access. Their marketing consent is not inferred.")}</p>
      {formError && <ErrorNotice bare>{formError}</ErrorNotice>}
      {onRemove && (confirmRemove ? (
        <div className="customer-remove-confirm">
          <p>{t("Remove this contact from the customer?")}</p>
          <Button type="button" size="sm" disabled={pending} onClick={onRemove}>{t("Confirm removal")}</Button>
          <Button type="button" size="sm" disabled={pending} onClick={() => setConfirmRemove(false)}>{t("Keep contact")}</Button>
        </div>
      ) : (
        <div><button type="button" className="lnk" disabled={pending} onClick={() => setConfirmRemove(true)}>{t("Remove contact")}</button></div>
      ))}
    </form>
  );
}

const CUSTOM_FIELD_TYPES: { value: CustomerCustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes or no" },
  { value: "date", label: "Date" },
];

function CustomFieldForm({
  initial, editing, pending, formError, onSubmit, onRemove,
}: {
  initial: CustomerCustomFieldForm;
  editing: boolean;
  pending: boolean;
  formError: string | null;
  onSubmit: (fields: CustomerCustomFieldForm) => void;
  onRemove?: () => void;
}) {
  const { t } = useLocale();
  const [fields, setFields] = useState(initial);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (patch: Partial<CustomerCustomFieldForm>) => setFields((current) => ({ ...current, ...patch }));
  return (
    <form id="crm-customer-custom-field" className="grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (!pending) onSubmit(fields);
    }}>
      <Field label={t("Field label")} id="crm-custom-label" required className="crm-field">
        {(c) => <input {...c} className="field" value={fields.label} onChange={(event) => set({ label: event.target.value })} maxLength={80} autoComplete="off" />}
      </Field>
      <Field label={t("Field key")} id="crm-custom-key" required hint={t("Stable identifier used by agents")} className="crm-field">
        {(c) => <input {...c} className="field" value={fields.key} onChange={(event) => set({ key: event.target.value })} disabled={editing} maxLength={40} autoComplete="off" placeholder="renewal_date" />}
      </Field>
      {editing ? (
        <p className="text-micro text-ink-500">{t("Type")}: {t(CUSTOM_FIELD_TYPES.find((option) => option.value === fields.type)?.label ?? "Text")}</p>
      ) : (
        <Field label={t("Type")} id="crm-custom-type" className="crm-field">
          {(c) => <Select id={c.id} aria-label={t("Type")} value={fields.type} full
            onChange={(value) => {
              if (CUSTOM_FIELD_TYPES.some((option) => option.value === value))
                set({ type: value as CustomerCustomFieldType, value: "" });
            }}
            options={CUSTOM_FIELD_TYPES.map((option) => ({ ...option, label: t(option.label) }))} />}
        </Field>
      )}
      <Field label={t("Value")} id="crm-custom-value" className="crm-field">
        {(c) => fields.type === "boolean" ? (
          <Select id={c.id} aria-label={t("Value")} value={fields.value} full
            onChange={(value) => set({ value })}
            options={[{ value: "", label: t("Choose") }, { value: "true", label: t("Yes") }, { value: "false", label: t("No") }]} />
        ) : (
          <input {...c} className="field" type={fields.type === "date" ? "date" : "text"}
            inputMode={fields.type === "number" ? "decimal" : undefined} value={fields.value}
            onChange={(event) => set({ value: event.target.value })} maxLength={fields.type === "text" ? 1000 : undefined} autoComplete="off" />
        )}
      </Field>
      <p className="text-micro text-ink-500">{t("Custom fields share this customer's access. Use consistent keys across your team.")}</p>
      {formError && <ErrorNotice bare>{formError}</ErrorNotice>}
      {onRemove && (confirmRemove ? (
        <div className="customer-remove-confirm">
          <p>{t("Remove this field from the customer?")}</p>
          <Button type="button" size="sm" disabled={pending} onClick={onRemove}>{t("Confirm removal")}</Button>
          <Button type="button" size="sm" disabled={pending} onClick={() => setConfirmRemove(false)}>{t("Keep field")}</Button>
        </div>
      ) : (
        <div><button type="button" className="lnk" disabled={pending} onClick={() => setConfirmRemove(true)}>{t("Remove field")}</button></div>
      ))}
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
  const canCreate = viewer.operator === true && (viewer.canCreate ?? !viewer.readOnly);
  const creationPolicy = useCrmQuery(scope, "records.list", { limit: 1 }, parseRecordList);
  const hostAssignedCreateId = creationPolicy.data?.hostAssignedCreateId ?? null;
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [creationUncertain, setCreationUncertain] = useState(false);
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
      {!canCreate ? (
        viewer.canvas ? null : (
          <Notice className="mt-2" state="read-only">
            {t("Creating customers is unavailable.")}
          </Notice>
        )
      ) : hostAssignedCreateId === null && creationPolicy.error !== null ? (
        <ErrorNotice onRetry={() => void creationPolicy.store.refresh()}>{creationPolicy.error}</ErrorNotice>
      ) : hostAssignedCreateId === null ? (
        <Loading>{t("Checking customer creation…")}</Loading>
      ) : (
        <div className="mt-2">
          {creationUncertain && (
            <Notice>{t("Creation could not be confirmed. Check the customer list before trying again.")}</Notice>
          )}
          <CustomerForm
            initial={EMPTY_CUSTOMER_FORM}
            submitLabel="Create customer"
            consentMethod
            pending={pending}
            submitBlocked={creationUncertain}
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
                .create(scope, hostAssignedCreateId ? null : newCustomerId(), profile, provenance ?? undefined)
                .then((record) => onCreated(record.id))
                .catch((e: unknown) => {
                  if (!isDefiniteCreateRefusal(e)) setCreationUncertain(true);
                  else setFormError(friendlyError(e));
                })
                .finally(() => setPending(false));
            }}
          />
        </div>
      )}
    </section>
  );
}

const CUSTOMER_TAB_PREFIX = "crm-customer";
const CUSTOMER_TABS = [
  { id: "overview", label: "Overview" },
  { id: "deals", label: "Deals" },
  { id: "tasks", label: "Tasks" },
  { id: "activity", label: "Activity" },
  { id: "fields", label: "Fields" },
  { id: "access", label: "Access" },
] as const;
type CustomerTab = typeof CUSTOMER_TABS[number]["id"];

function customerAccessRefused(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return [401, 403, 404, 409, 503].includes(error.status) ||
    ["unauthorized", "forbidden", "not_found", "conflict", "unavailable", "record_changed", "record_access_unavailable"].includes(error.code ?? "");
}

function CustomerWorkspace({
  scope,
  recordId,
  viewer,
  onClose,
  onMerged,
}: {
  scope: HostScope;
  recordId: string;
  viewer: Viewer;
  onClose: () => void;
  onMerged: (targetId: string) => void;
}) {
  const { t, formatDate } = useLocale();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [activeTab, setActiveTab] = useState<CustomerTab>("overview");
  const openTab = (tab: CustomerTab) => {
    setActiveTab(tab);
    headingRef.current?.ownerDocument.getElementById(`${CUSTOMER_TAB_PREFIX}-tab-${tab}`)?.focus();
  };
  const [selectedActivity, setSelectedActivity] = useState<{ key: string; record: HostRecord } | null>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [recordId]);
  // The profile is private. This pane is keyed by mount and record, and
  // never imports a prior pane's cache or the host's pushed observations.
  const [recordStore] = useState(() => new Resource(
    () => hostActions.show(scope, recordId),
    { discardOnError: customerAccessRefused },
  ));
  const { data, error, inFlight } = useQuery(recordStore);
  const latestRecord = useRef<HostRecord | null>(null);
  latestRecord.current = data;
  const historyRequest = useRef(0);
  const activityListRef = useRef<HTMLOListElement>(null);
  const historyKeyboardTrigger = useRef<{ element: HTMLElement; previous: Set<string> } | null>(null);
  const [olderHistory, setOlderHistory] = useState<{ base: HostRecord; value: HostRecord } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAnnouncement, setHistoryAnnouncement] = useState("");
  const [historyAccessLost, setHistoryAccessLost] = useState(false);
  const writeFence = useRef(0);
  const editOpener = useRef<{ element: HTMLElement | null; tab: CustomerTab } | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const previousMode = useRef("view");
  useEffect(() => () => {
    historyRequest.current += 1;
    writeFence.current += 1;
    recordStore.pause();
  }, [recordStore]);
  useEffect(() => {
    historyRequest.current += 1;
    setOlderHistory(null);
    setHistoryBusy(false);
    setHistoryError(null);
    setHistoryAnnouncement("");
    historyKeyboardTrigger.current = null;
    if (data !== null) setHistoryAccessLost(false);
  }, [data]);
  useEffect(() => {
    const trigger = historyKeyboardTrigger.current;
    if (olderHistory && trigger && (document.activeElement === trigger.element || document.activeElement === document.body)) {
      const firstAdded = [...(activityListRef.current?.querySelectorAll<HTMLButtonElement>("[data-activity-key]") ?? [])]
        .find((button) => !trigger.previous.has(button.dataset.activityKey ?? ""));
      (firstAdded ?? activityListRef.current)?.focus();
    }
    historyKeyboardTrigger.current = null;
  }, [olderHistory]);
  const canWrite = canEditCustomer(viewer, data);
  const [mode, setMode] = useState<"view" | "edit" | "consent" | "contact" | "custom">("view");
  const [editRecord, setEditRecord] = useState<HostRecord | null>(null);
  const [contactIndex, setContactIndex] = useState<number | null>(null);
  const [customKey, setCustomKey] = useState<string | null>(null);
  const record = data === null ? null : mode === "view" ? data : editRecord;
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notes, setNotes] = useState<CustomerNoteRecord[]>([]);
  const [notesUnsupported, setNotesUnsupported] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [notePending, setNotePending] = useState(false);
  const [noteFormError, setNoteFormError] = useState<string | null>(null);
  const [confirmArchiveId, setArchiveConfirmId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [dealTitleDraft, setDealTitleDraft] = useState("");
  const [dealAmountDraft, setDealAmountDraft] = useState("0");
  const [dealStageDraft, setDealStageDraft] = useState<DealStage>("lead");
  const [dealPending, setDealPending] = useState(false);
  const [dealFormError, setDealFormError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskTitleDraft, setTaskTitleDraft] = useState("");
  const [taskDueDraft, setTaskDueDraft] = useState("");
  const [taskPending, setTaskPending] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [touchpoints, setTouchpoints] = useState<TouchpointRecord[]>([]);
  const [touchpointsError, setTouchpointsError] = useState<string | null>(null);
  const [tpChannel, setTpChannel] = useState<TouchpointChannel>("note");
  const [tpDirection, setTpDirection] = useState<TouchpointDirection>("outbound");
  const [tpSummary, setTpSummary] = useState("");
  const [tpPending, setTpPending] = useState(false);
  const [tpFormError, setTpFormError] = useState<string | null>(null);
  const notesRequest = useRef(0);
  const refreshRelated = () => {
    setDealsError(null);
    setTasksError(null);
    setTouchpointsError(null);
    void hostActions.listDeals(scope, { customerId: recordId, limit: 100 })
      .then((res) => setDeals(res.deals))
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) setDeals([]);
        else setDealsError(friendlyError(err));
      });
    void hostActions.listTasks(scope, { customerId: recordId, limit: 100 })
      .then((res) => setTasks(res.tasks))
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) setTasks([]);
        else setTasksError(friendlyError(err));
      });
    void hostActions.listTouchpoints(scope, recordId)
      .then((rows) => setTouchpoints(rows))
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) setTouchpoints([]);
        else setTouchpointsError(friendlyError(err));
      });
  };
  const refreshNotes = () => {
    const req = ++notesRequest.current;
    setNotesError(null);
    void hostActions.listNotes(scope, recordId)
      .then((rows) => {
        if (notesRequest.current !== req) return;
        setNotes(rows);
        setNotesUnsupported(false);
      })
      .catch((err: unknown) => {
        if (notesRequest.current !== req) return;
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
          setNotes([]);
          setNotesUnsupported(true);
        } else {
          setNotesError(friendlyError(err));
        }
      });
  };
  useEffect(() => {
    setMode("view");
    setMergeOpen(false);
    setEditRecord(null);
    setFormError(null);
    setNoteDraft("");
    setNoteFormError(null);
    setArchiveConfirmId(null);
    setNotes([]);
    setNotesUnsupported(false);
    setNotesError(null);
    setDeals([]);
    setTasks([]);
    setTouchpoints([]);
  }, [recordId, scope]);
  useEffect(() => {
    if (viewer.operator === true && data !== null) {
      refreshNotes();
      refreshRelated();
    }
    return () => { notesRequest.current += 1; };
  }, [recordId, scope, viewer.operator, data !== null]);
  useEffect(() => {
    const wasEditing = previousMode.current !== "view";
    previousMode.current = mode;
    if (!wasEditing || mode !== "view") return;
    const opener = editOpener.current;
    editOpener.current = null;
    if (!opener || opener.tab !== activeTab) return;
    const frame = requestAnimationFrame(() => {
      const workspace = workspaceRef.current;
      if (!workspace || !document.hasFocus() || (document.activeElement !== document.body && document.activeElement !== workspace)) return;
      const target = opener.element;
      if (target?.isConnected && workspace.contains(target) && target.getClientRects().length > 0 && !target.matches(":disabled")) {
        target.focus();
      } else {
        headingRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, activeTab]);

  const rememberEditOpener = () => {
    editOpener.current = { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, tab: activeTab };
  };

  const view = record ? viewProfile(record.profile) : null;
  const contacts = record ? readCustomerContacts(record.profile) : null;
  const customFields = record ? readCustomerCustomFields(record.profile) : null;
  const activityRecord = olderHistory?.base === record ? olderHistory.value : record;
  const timeline = activityRecord ? activityItems(activityRecord, t) : [];

  const initials = view
    ? view.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : "";
  const reload = () => { void recordStore.refresh(); };
  const ready = error === null && !historyAccessLost && viewer.operator === true && record !== null && view !== null;
  const activity = selectedActivity?.record === record
    ? timeline.find((item) => item.key === selectedActivity.key)
    : undefined;
  const loadOlder = (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    if (mode !== "view" || !record || !activityRecord?.historyNextCursor || historyBusy) return;
    const base = record;
    const page = activityRecord;
    historyKeyboardTrigger.current = event.detail === 0
      ? { element: event.currentTarget, previous: new Set(timeline.map((item) => item.key)) }
      : null;
    const request = ++historyRequest.current;
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryAnnouncement("");
    void hostActions.show(scope, recordId, page.historyNextCursor)
      .then((next) => {
        if (historyRequest.current !== request || latestRecord.current !== base) return;
        setOlderHistory({ base, value: appendHistoryPage(page, next) });
        setHistoryAnnouncement(t("Earlier activity loaded."));
      })
      .catch((error: unknown) => {
        if (historyRequest.current !== request || latestRecord.current !== base) return;
        historyKeyboardTrigger.current = null;
        if (customerAccessRefused(error)) {
          historyRequest.current += 1;
          setHistoryBusy(false);
          setOlderHistory(null);
          setSelectedActivity(null);
          setMode("view");
          setEditRecord(null);
          writeFence.current += 1;
          setPending(false);
          recordStore.reset();
          setHistoryAccessLost(true);
        } else {
          setHistoryError(t("Could not load earlier activity. Reload the customer and try again."));
        }
      })
      .finally(() => {
        if (historyRequest.current === request) setHistoryBusy(false);
      });
  };
  const openContact = (index: number | null) => {
    rememberEditOpener();
    setEditRecord(record);
    setContactIndex(index);
    setFormError(null);
    setMode("contact");
  };
  const openCustomField = (key: string | null) => {
    rememberEditOpener();
    setEditRecord(record);
    setCustomKey(key);
    setFormError(null);
    setMode("custom");
  };
  const when = (at: number, withTime = false) => {
    const time = at * 1000;
    return Number.isFinite(time) && !Number.isNaN(new Date(time).getTime())
      ? formatDate(time, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" })
      : t("Not recorded");
  };
  const activityRow = (item: (typeof timeline)[number], source: "timeline" | "recent") => (
    <li key={item.key}>
      <button
        type="button"
        className="customer-activity-row"
        data-activity-key={source === "timeline" ? item.key : undefined}
        aria-haspopup="dialog"
        onClick={() => { if (record) setSelectedActivity({ key: item.key, record }); }}
      >
        <span className="customer-activity-copy">
          <span>{item.text}</span>
          <span className="num text-micro text-ink-500">{when(item.at)}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
    </li>
  );
  const panels = ready && record !== null && view !== null ? {
    overview: (
      <div className="customer-workspace-grid">
        <div className="customer-profile-panel">
          <section className="crm-sect" aria-label={t("Profile")}>
            <h4>{t("Profile")}</h4>
            <Detail
              className="crm-detail"
              label={t("Customer fields")}
              items={[
                { key: "type", term: t("Customer type"), value: view.customerType === "" ? t("Not specified") : t(view.customerType === "person" ? "Person" : "Organization") },
                { key: "email", term: t("Email"), value: <span className="num">{view.email ?? "—"}</span> },
                { key: "phone", term: t("Phone"), value: <span className="num">{view.phone ?? "—"}</span> },
                { key: "website", term: t("Website"), value: view.website ?? "—" },
                { key: "tags", term: t("Tags"), value: view.tags.length > 0 ? view.tags.join(", ") : "—" },
              ]}
            />
          </section>
          <section className="crm-sect" aria-label={t("Contacts")}>
            <div className="customer-section-heading">
              <h4>{t("Contacts")}</h4>
              {canWrite && contacts !== null && contacts.length < 50 && (
                <Button size="sm" onClick={() => openContact(null)}>{t("Add contact")}</Button>
              )}
            </div>
            {contacts === null ? (
              <p className="text-secondary text-ink-400">{t("Contacts are unavailable for this record.")}</p>
            ) : contacts.length === 0 ? (
              <p className="text-secondary text-ink-400">{t("No contacts recorded yet.")}</p>
            ) : (
              <ul className="customer-contacts">
                {contacts.map((contact, index) => (
                  <li key={index}>
                    <div>
                      <strong>{contact.name}</strong>
                      {contact.title && <p>{contact.title}</p>}
                      {contact.email && <p className="num">{contact.email}</p>}
                      {contact.phone && <p className="num">{contact.phone}</p>}
                    </div>
                    {canWrite && <Button size="sm" aria-label={`${t("Edit contact")} ${contact.name}`} onClick={() => openContact(index)}>{t("Edit")}</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
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
        </div>
        <aside className="customer-activity-panel" aria-label={t("Recent activity")}>
          <div className="customer-section-heading">
            <h4>{t("Recent activity")}</h4>
            <Button size="sm" onClick={() => openTab("activity")}>{t("View all activity")}</Button>
          </div>
          {timeline.length > 0 ? (
            <ol className="crm-timeline" aria-label={t("Recent activity")}>
              {timeline.slice(0, 2).map((item) => activityRow(item, "recent"))}
            </ol>
          ) : (
            <p className="text-secondary text-ink-400">{t(record.recordAccess ? "No visible activity." : "No activity recorded yet.")}</p>
          )}
        </aside>
      </div>
    ),
    deals: (
      <section className="crm-sect" aria-label={t("Deals")}>
        <h4>{t("Deals")}</h4>
        {canWrite && (
          <form
            className="grid gap-2 mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = dealTitleDraft.trim();
              const parsed = Number(dealAmountDraft);
              if (!trimmed) { setDealFormError(t("Deal title is required.")); return; }
              if (!Number.isFinite(parsed) || parsed < 0) { setDealFormError(t("Enter a valid deal value.")); return; }
              setDealPending(true);
              setDealFormError(null);
              void hostActions
                .createDeal(scope, { customerId: recordId, title: trimmed, stage: dealStageDraft, amountCents: Math.round(parsed * 100) })
                .then(() => { setDealTitleDraft(""); setDealAmountDraft("0"); refreshRelated(); })
                .catch((err: unknown) => setDealFormError(friendlyError(err)))
                .finally(() => setDealPending(false));
            }}
          >
            <div className="crm-field-row flex gap-2">
              <Field label={t("Deal title")} id="crm-cust-deal-title" className="crm-field">
                {(c) => <input {...c} className="field" maxLength={200} value={dealTitleDraft} onChange={(e) => setDealTitleDraft(e.target.value)} />}
              </Field>
              <Field label={t("Stage")} id="crm-cust-deal-stage" className="crm-field">
                {(c) => (
                  <Select
                    {...c}
                    value={dealStageDraft}
                    onChange={(v) => setDealStageDraft(v as DealStage)}
                    options={DEAL_STAGES.map((s) => ({ value: s, label: t(s) }))}
                  />
                )}
              </Field>
              <Field label={t("Amount")} id="crm-cust-deal-amount" className="crm-field">
                {(c) => <input {...c} type="number" min="0" step="0.01" className="field" value={dealAmountDraft} onChange={(e) => setDealAmountDraft(e.target.value)} />}
              </Field>
            </div>
            {dealFormError && <ErrorNotice bare>{dealFormError}</ErrorNotice>}
            <div>
              <Button type="submit" size="sm" variant="primary" loading={dealPending} disabled={dealPending || !dealTitleDraft.trim()}>
                {t("Add deal")}
              </Button>
            </div>
          </form>
        )}
        {dealsError ? <ErrorNotice onRetry={refreshRelated}>{dealsError}</ErrorNotice>
          : deals.length === 0 ? <p className="text-secondary text-ink-400">{t("No deals linked to this customer.")}</p>
          : (
            <ul className="customer-contacts" aria-label={t("Deals")}>
              {deals.map((deal) => (
                <li key={deal.id}>
                  <div>
                    <strong>{deal.title}</strong>
                    <p className="num">{deal.stage} · {deal.currency} {(deal.amountCents / 100).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
    ),
    tasks: (
      <section className="crm-sect" aria-label={t("Tasks")}>
        <h4>{t("Tasks")}</h4>
        {canWrite && (
          <form
            className="grid gap-2 mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = taskTitleDraft.trim();
              if (!trimmed) { setTaskFormError(t("Task title is required.")); return; }
              setTaskPending(true);
              setTaskFormError(null);
              void hostActions
                .createTask(scope, { customerId: recordId, title: trimmed, dueAt: taskDueDraft.trim() || null })
                .then(() => { setTaskTitleDraft(""); setTaskDueDraft(""); refreshRelated(); })
                .catch((err: unknown) => setTaskFormError(friendlyError(err)))
                .finally(() => setTaskPending(false));
            }}
          >
            <div className="crm-field-row flex gap-2">
              <Field label={t("Task title")} id="crm-cust-task-title" className="crm-field">
                {(c) => <input {...c} className="field" maxLength={200} value={taskTitleDraft} onChange={(e) => setTaskTitleDraft(e.target.value)} />}
              </Field>
              <Field label={t("Due date")} id="crm-cust-task-due" className="crm-field">
                {(c) => <input {...c} type="date" className="field" value={taskDueDraft} onChange={(e) => setTaskDueDraft(e.target.value)} />}
              </Field>
            </div>
            {taskFormError && <ErrorNotice bare>{taskFormError}</ErrorNotice>}
            <div>
              <Button type="submit" size="sm" variant="primary" loading={taskPending} disabled={taskPending || !taskTitleDraft.trim()}>
                {t("Add task")}
              </Button>
            </div>
          </form>
        )}
        {tasksError ? <ErrorNotice onRetry={refreshRelated}>{tasksError}</ErrorNotice>
          : tasks.length === 0 ? <p className="text-secondary text-ink-400">{t("No tasks linked to this customer.")}</p>
          : (
            <ul className="customer-contacts" aria-label={t("Tasks")}>
              {tasks.map((task) => (
                <li key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <p className="num">{task.status}{task.dueAt ? ` · ${task.dueAt.slice(0, 10)}` : ""}</p>
                  </div>
                  {canWrite && task.status === "open" && (
                    <Button
                      size="sm"
                      disabled={taskPending}
                      onClick={() => {
                        setTaskPending(true);
                        void hostActions.updateTask(scope, task.id, task.revision, { status: "done" })
                          .then(() => refreshRelated())
                          .finally(() => setTaskPending(false));
                      }}
                    >
                      {t("Mark done")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
    ),
    activity: (
      <section className="customer-activity-panel" aria-label={t("Activity")}>
        <div className="crm-sect">
          <h4>{t("Touchpoints")}</h4>
          {canWrite && (
            <form
              className="grid gap-2 mb-3"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = tpSummary.trim();
                if (!trimmed) { setTpFormError(t("Touchpoint summary is required.")); return; }
                setTpPending(true);
                setTpFormError(null);
                void hostActions
                  .createTouchpoint(scope, { customerId: recordId, channel: tpChannel, direction: tpDirection, summary: trimmed })
                  .then(() => { setTpSummary(""); refreshRelated(); })
                  .catch((err: unknown) => setTpFormError(friendlyError(err)))
                  .finally(() => setTpPending(false));
              }}
            >
              <div className="crm-field-row flex gap-2">
                <Field label={t("Channel")} id="crm-tp-channel" className="crm-field">
                  {(c) => (
                    <Select
                      {...c}
                      value={tpChannel}
                      onChange={(v) => setTpChannel(v as TouchpointChannel)}
                      options={TOUCHPOINT_CHANNELS.map((ch) => ({ value: ch, label: t(ch) }))}
                    />
                  )}
                </Field>
                <Field label={t("Direction")} id="crm-tp-dir" className="crm-field">
                  {(c) => (
                    <Select
                      {...c}
                      value={tpDirection}
                      onChange={(v) => setTpDirection(v as TouchpointDirection)}
                      options={[
                        { value: "outbound", label: t("Outbound") },
                        { value: "inbound", label: t("Inbound") },
                        { value: "internal", label: t("Internal") },
                      ]}
                    />
                  )}
                </Field>
              </div>
              <Field label={t("Interaction summary")} id="crm-tp-summary" className="crm-field">
                {(c) => <input {...c} className="field" maxLength={2000} value={tpSummary} onChange={(e) => { setTpSummary(e.target.value); setTpFormError(null); }} />}
              </Field>
              {tpFormError && <ErrorNotice bare>{tpFormError}</ErrorNotice>}
              <div>
                <Button type="submit" size="sm" loading={tpPending} disabled={tpPending || !tpSummary.trim()}>
                  {t("Log touchpoint")}
                </Button>
              </div>
            </form>
          )}
          {touchpointsError ? <ErrorNotice onRetry={refreshRelated}>{touchpointsError}</ErrorNotice>
            : touchpoints.length === 0 ? <p className="text-secondary text-ink-400">{t("No touchpoints recorded yet.")}</p>
            : (
              <ul className="customer-contacts" aria-label={t("Touchpoints")}>
                {touchpoints.map((tp) => (
                  <li key={tp.id}>
                    <div>
                      <strong>{tp.channel} ({tp.direction})</strong>
                      <p>{tp.summary}</p>
                      <p className="num text-micro text-ink-500">{tp.occurredAt.slice(0, 10)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>
        <div className="crm-sect">
          <h4>{t("Notes")}</h4>
          {canWrite && !notesUnsupported && (
            <form
              className="grid gap-2 mb-3"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = noteDraft.trim();
                if (trimmed.length === 0 || trimmed.length > 4000) {
                  setNoteFormError(t("Note must be 1–4000 characters"));
                  return;
                }
                setNotePending(true);
                setNoteFormError(null);
                void hostActions
                  .createNote(scope, recordId, trimmed)
                  .then(() => {
                    setNoteDraft("");
                    refreshNotes();
                  })
                  .catch((err: unknown) => setNoteFormError(friendlyError(err)))
                  .finally(() => setNotePending(false));
              }}
            >
              <Field label={t("Note text")} id="crm-note-body" className="crm-field">
                {(c) => (
                  <textarea
                    {...c}
                    className="field"
                    rows={3}
                    maxLength={4000}
                    value={noteDraft}
                    onChange={(e) => { setNoteDraft(e.target.value); setNoteFormError(null); }}
                  />
                )}
              </Field>
              {noteFormError && <ErrorNotice bare>{noteFormError}</ErrorNotice>}
              <div>
                <Button type="submit" size="sm" variant="primary" loading={notePending} disabled={notePending || !noteDraft.trim()}>
                  {t("Save note")}
                </Button>
              </div>
            </form>
          )}
          {notesUnsupported ? (
            <p className="text-secondary text-ink-400">{t("Notes are unavailable on this board.")}</p>
          ) : notesError ? (
            <ErrorNotice onRetry={refreshNotes}>{notesError}</ErrorNotice>
          ) : notes.length === 0 ? (
            <p className="text-secondary text-ink-400">{t("No notes recorded yet.")}</p>
          ) : (
            <ul className="customer-contacts" aria-label={t("Notes")}>
              {notes.map((note) => (
                <li key={note.id}>
                  <div>
                    <p>{note.body}</p>
                  </div>
                  {canWrite && (confirmArchiveId === note.id ? (
                    <div className="customer-remove-confirm">
                      <p>{t("Archive this note?")}</p>
                      <Button
                        type="button"
                        size="sm"
                        disabled={notePending}
                        onClick={() => {
                          setNotePending(true);
                          setNoteFormError(null);
                          void hostActions
                            .archiveNote(scope, note.id, note.revision)
                            .then(() => {
                              setArchiveConfirmId(null);
                              refreshNotes();
                            })
                            .catch((err: unknown) => setNoteFormError(friendlyError(err)))
                            .finally(() => setNotePending(false));
                        }}
                      >
                        {t("Confirm archive")}
                      </Button>
                      <Button type="button" size="sm" disabled={notePending} onClick={() => setArchiveConfirmId(null)}>
                        {t("Keep note")}
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" disabled={notePending} onClick={() => setArchiveConfirmId(note.id)}>
                      {t("Archive")}
                    </Button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
        <h4>{t("Activity")}</h4>
        <p className="text-micro text-ink-500">{t("Shows profile changes and available notes only.")}</p>
        {activityRecord?.historyTruncated && !activityRecord.historyNextCursor
          ? <p className="text-micro text-ink-500">{t(record.recordAccess ? "Only recent changes are shown; earlier history may be unavailable after access is enabled." : "Only recent record changes are shown.")}</p>
          : record.recordAccess && <p className="text-micro text-ink-500">{t("Earlier activity may not be shown when customer access is enabled.")}</p>}
        <span role="status" className="sr-only">{historyAnnouncement}</span>
        {timeline.length > 0 ? (
          <ol ref={activityListRef} tabIndex={-1} className="crm-timeline" aria-label={t("Activity")}>
            {timeline.map((item) => activityRow(item, "timeline"))}
          </ol>
        ) : (
          <p className="text-secondary text-ink-400">{t(record.recordAccess ? "No visible activity." : "No activity recorded yet.")}</p>
        )}
        {historyError && <ErrorNotice onRetry={reload}>{historyError}</ErrorNotice>}
        {activityRecord?.historyNextCursor && (
          <Button size="sm" loading={historyBusy} disabled={historyBusy || mode !== "view"} onClick={loadOlder}>
            {t("Load earlier activity")}
          </Button>
        )}
      </section>
    ),
    fields: (
      <section className="crm-sect" aria-label={t("Custom fields")}>
        <div className="customer-section-heading">
          <h4>{t("Custom fields")}</h4>
          {canWrite && customFields !== null && Object.keys(customFields).length < 64 && (
            <Button size="sm" onClick={() => openCustomField(null)}>{t("Add field")}</Button>
          )}
        </div>
        {customFields === null ? (
          <p className="text-secondary text-ink-400">{t("Custom fields are unavailable for this record.")}</p>
        ) : Object.keys(customFields).length === 0 ? (
          <p className="text-secondary text-ink-400">{t("No custom fields recorded yet.")}</p>
        ) : (
          <ul className="customer-contacts">
            {Object.entries(customFields).map(([key, field]) => (
              <li key={key}>
                <div>
                  <strong>{field.label}</strong>
                  <p>{field.type === "boolean" ? t(field.value ? "Yes" : "No") : String(field.value)}</p>
                  <p className="num">{key}</p>
                </div>
                {canWrite && <Button size="sm" aria-label={`${t("Edit field")} ${field.label}`} onClick={() => openCustomField(key)}>{t("Edit")}</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    ),
    access: (
      <section className="crm-sect" aria-label={t("Access")}>
        <h4>{t("Your access")}</h4>
        <p>{t(canWrite ? "You can view and edit this customer." : "You can view this customer, but cannot edit it.")}</p>
        <p className="text-secondary text-ink-400">{t("Customer sharing cannot be managed from this screen.")}</p>
        <details className="crm-diag">
          <summary>{t("Record diagnostics")}</summary>
          <p className="text-micro text-ink-500 mb-2">
            {t("Selection is chat context only — the server re-proves scope on every send.")}
          </p>
          <p className="num text-micro text-ink-500">
            {t("Record")} <span className="num">{recordId}</span> · {t("revision")} r{record.revision} · {t("digest")}{" "}
            {record.digest.slice(0, 18)}…
          </p>
        </details>
      </section>
    ),
  } : null;

  const save = (profile: Record<string, unknown>, provenance?: { method: ConsentMethod; note?: string }) => {
    if (!ready || !canWrite || record === null) return;
    const fence = writeFence.current;
    setPending(true);
    setFormError(null);
    void hostActions
      .update(scope, recordId, record.revision, profile, provenance)
      .then((next) => {
        if (writeFence.current !== fence) return;
        recordStore.write(() => next);
        setMode("view");
      })
      .catch((e: unknown) => { if (writeFence.current === fence) setFormError(friendlyError(e)); })
      .finally(() => { if (writeFence.current === fence) setPending(false); });
  };

  return (
    <section ref={workspaceRef} className="customer-workspace" aria-label={t("Customer details")}>
      <button type="button" className="lnk customer-back" onClick={onClose}>← {t("All customers")}</button>
      <header className="customer-header">
        <div className="customer-heading">
          {ready && initials && <span className="customer-avatar" aria-hidden="true">{initials}</span>}
          <div>
            <p className="text-micro text-ink-500">{t("Customer")}</p>
            <h3 ref={headingRef} tabIndex={-1} data-outlet-heading className="text-cardtitle font-medium text-ink-100">
              {ready && view ? view.displayName : t("Customer details")}
            </h3>
            {ready && view && <p className="customer-contact text-label text-ink-400">{[view.email, view.phone].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>
        {ready && (canWrite || view?.email) && (
          <div className="customer-actions">
            {view?.email && (
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(view.email ?? "")}>
                {t("Copy email")}
              </Button>
            )}
            {canWrite && (
              <>
                {viewer.canMerge && (
                  <Button size="sm" onClick={() => setMergeOpen(true)}>{t("Merge duplicate")}</Button>
                )}
                <Button size="sm" onClick={() => { rememberEditOpener(); setEditRecord(record); setMode("consent"); setFormError(null); }}>{t("Record consent")}</Button>
                <Button size="sm" variant="primary" onClick={() => { rememberEditOpener(); setEditRecord(record); setMode("edit"); setFormError(null); }}>{t("Edit")}</Button>
              </>
            )}
          </div>
        )}
      </header>
      {data === null && (inFlight || (error === null && !historyAccessLost && viewer.operator === true)) ? <Loading>{t("Reading the record…")}</Loading>
        : error !== null ? <ErrorNotice onRetry={reload}>{error}</ErrorNotice>
          : historyAccessLost ? <ErrorNotice onRetry={reload}>{t("Customer access changed. Reload to continue.")}</ErrorNotice>
          : !ready ? <Notice>{t("You do not have access to customer records.")}</Notice>
            : (
              <>
                <span role="status"><QueryRefresh updating={inFlight} /></span>
                {!canWrite && !viewer.canvas && <Notice state="read-only">{t("You can view this customer, but cannot edit it.")}</Notice>}
                <WorkspaceTabs
                  idPrefix={CUSTOMER_TAB_PREFIX}
                  label="Customer sections"
                  tabs={CUSTOMER_TABS}
                  active={activeTab}
                  onChange={setActiveTab}
                >
                  {panels?.[activeTab]}
                </WorkspaceTabs>
              </>
            )}
      {mode !== "view" && canWrite && ready && record !== null && (
        <FrameDrawer
          kind="customer-edit"
          label={t("Customer details")}
          title={view?.displayName ?? t("Customer details")}
          tabs={[]}
          edit={mode === "edit"
            ? {
                formId: "crm-customer-edit",
                title: t("Edit profile — saving is refused if the record changed since you opened it"),
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
            : mode === "consent" ? {
                formId: "crm-customer-consent",
                title: t("Record consent"),
                saveLabel: t("Save consent"),
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
            : mode === "contact" ? {
                formId: "crm-customer-contact",
                title: t(contactIndex === null ? "Add contact" : "Edit contact"),
                saveLabel: t("Save contact"),
                pending,
                onCancel: () => setMode("view"),
                body: contacts === null ? <Notice>{t("Contacts are unavailable for this record.")}</Notice> : (
                  <ContactForm
                    key={`${record.revision}-${contactIndex ?? "new"}`}
                    formId="crm-customer-contact"
                    initial={{
                      name: contactIndex === null ? "" : contacts[contactIndex]?.name ?? "",
                      title: contactIndex === null ? "" : contacts[contactIndex]?.title ?? "",
                      email: contactIndex === null ? "" : contacts[contactIndex]?.email ?? "",
                      phone: contactIndex === null ? "" : contacts[contactIndex]?.phone ?? "",
                    }}
                    pending={pending}
                    formError={formError}
                    onSubmit={(fields) => {
                      try {
                        save(changeCustomerContacts(contacts, contactIndex, fields));
                      } catch (e: unknown) {
                        setFormError(friendlyError(e, t));
                      }
                    }}
                    {...(contactIndex === null ? {} : { onRemove: () => {
                      try {
                        save(changeCustomerContacts(contacts, contactIndex, null));
                      } catch (e: unknown) {
                        setFormError(friendlyError(e, t));
                      }
                    } })}
                  />
                ),
              }
            : {
                formId: "crm-customer-custom-field",
                title: t(customKey === null ? "Add field" : "Edit field"),
                saveLabel: t("Save field"),
                pending,
                onCancel: () => setMode("view"),
                body: customFields === null ? <Notice>{t("Custom fields are unavailable for this record.")}</Notice> : (
                  <CustomFieldForm
                    key={`${record.revision}-${customKey ?? "new"}`}
                    editing={customKey !== null}
                    initial={{
                      key: customKey ?? "",
                      label: customKey === null ? "" : customFields[customKey]?.label ?? "",
                      type: customKey === null ? "text" : customFields[customKey]?.type ?? "text",
                      value: customKey === null ? "" : String(customFields[customKey]?.value ?? ""),
                    }}
                    pending={pending}
                    formError={formError}
                    onSubmit={(fields) => {
                      try {
                        save(changeCustomerCustomFields(customFields, customKey, fields));
                      } catch (e: unknown) {
                        setFormError(friendlyError(e, t));
                      }
                    }}
                    {...(customKey === null ? {} : { onRemove: () => {
                      try {
                        save(changeCustomerCustomFields(customFields, customKey, null));
                      } catch (e: unknown) {
                        setFormError(friendlyError(e, t));
                      }
                    } })}
                  />
                ),
              }
          }
          onClose={() => setMode("view")}
        />
      )}
      {ready && mergeOpen && canWrite && viewer.canMerge && record !== null && (
        <MergeCustomerDrawer
          scope={scope}
          source={record}
          onClose={() => setMergeOpen(false)}
          onMerged={(targetId) => {
            setMergeOpen(false);
            onMerged(targetId);
          }}
        />
      )}
      {ready && mode === "view" && activity && (
        <FrameDrawer
          kind="customer-activity"
          label={t("Activity details")}
          title={t("Activity details")}
          tabs={[{
            id: "details",
            label: t("Details"),
            panel: (
              <div className="customer-activity-details">
                <section>
                  <h4>{t("Activity summary")}</h4>
                  <p>{activity.text}</p>
                </section>
                {activity.note && <section><h4>{t("Note")}</h4><p>{activity.note}</p></section>}
                {activity.changes && activity.changes.length > 0 && (
                  <section aria-label={t("Changed fields")}>
                    <h4>{t("Changed fields")}</h4>
                    <ul className="customer-changes">
                      {activity.changes.map((change) => (
                        <li key={change.field}>
                          <h5>{change.field}</h5>
                          <dl>
                            <div><dt>{t("Before")}</dt><dd>{change.before}</dd></div>
                            <div><dt>{t("After")}</dt><dd>{change.after}</dd></div>
                          </dl>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <Detail className="crm-detail" label={t("Activity details")} items={[
                  { key: "type", term: t("Type"), value: t(activity.kind === "note" ? "Note" : activity.kind === "consent" ? "Consent" : "Record change") },
                  { key: "actor", term: t("Recorded by"), value: activity.actor === "operator" ? t("the operator") : (activity.actor || t("Not recorded")) },
                  { key: "date", term: t("Recorded at"), value: when(activity.at, true) },
                  ...(activity.revision === undefined ? [] : [{ key: "revision", term: t("Revision"), value: `r${activity.revision}` }]),
                ]} />
              </div>
            ),
          }]}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </section>
  );
}
