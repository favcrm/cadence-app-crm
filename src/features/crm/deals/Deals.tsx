import { useLocale } from "../locale";
import { ApiError, Button, DataTable, EmptyState, ErrorNotice, Field, Loading, Notice, Select } from "@cadence/screen-ui";
import { useEffect, useState } from "react";
import FrameDrawer from "../FrameDrawer";
import { onScopeRetired } from "../../../bridge/scope";
import { queryPatch, readQueryParams, type QueryParams } from "../../../domain/routeParams";
import { useRouteParams, useRouteParamSync } from "../useRouteParams";
import { QueryRefresh, useCrmQuery } from "../resources";
import {
  DEAL_STAGES,
  hostActions,
  type DealRecord,
  type DealStage,
  type DealStageAggregate,
  type HostScope,
} from "../hostActions";
import { hostErrorText, isApprovalRequired } from "../hostErrors";
import type { Viewer } from "../viewer";

const STAGE_LABEL: Record<DealStage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

function formatAmount(cents: number, currency: string): string {
  const value = (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currency || "HKD"} ${value}`;
}

export default function Deals({
  scope,
  viewer,
  view,
  recordId,
  onView,
  onSelect,
}: {
  scope: HostScope;
  viewer: Viewer;
  view: "list" | "new";
  recordId: string | null;
  onView: (view: "list" | "new") => void;
  onSelect: (recordId: string | null) => void;
}) {
  const { t, formatNumber } = useLocale();
  const routeParams = useRouteParams();
  const [initialParams] = useState(() => readQueryParams(routeParams));
  const [query, setQuery] = useState(initialParams.q);
  const [committed, setCommitted] = useState(initialParams.q);
  const [stageFilter, setStageFilter] = useState<DealStage | "">("");

  useRouteParamSync<QueryParams>({ q: committed }, readQueryParams, queryPatch, (next) => {
    setQuery(next.q);
    setCommitted(next.q);
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim();
      if (next !== committed) setCommitted(next);
    }, 250);
    const unsub = onScopeRetired(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [query, committed]);

  const listState = useCrmQuery(
    scope,
    "records.list",
    { table: "deals", query: committed || undefined, stage: stageFilter || undefined, limit: 100 },
    (raw) => {
      const page = raw as { records?: unknown[] };
      return Array.isArray(page?.records) ? { records: page.records } : { records: [] };
    },
  );
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [stageTotals, setStageTotals] = useState<DealStageAggregate[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const canWrite = viewer.operator === true && !viewer.canvas && (viewer.canCreate ?? !viewer.readOnly);

  useEffect(() => {
    if (viewer.operator !== true) return;
    let active = true;
    setDealsError(null);
    void Promise.all([
      hostActions.listDeals(scope, {
        query: committed || undefined,
        stage: stageFilter || undefined,
        limit: 100,
      }),
      hostActions.aggregateDealsByStage(scope, committed || undefined).catch(() => []),
      hostActions.list(scope, { limit: 100 }).catch(() => null),
    ])
      .then(([listRes, aggs, custRes]) => {
        if (!active) return;
        setDeals(listRes.deals);
        setStageTotals(aggs);
        if (custRes) {
          const map: Record<string, string> = {};
          for (const rec of custRes.records) {
            const profile = rec.profile as { display_name?: unknown } | null;
            if (typeof profile?.display_name === "string" && profile.display_name.trim()) {
              map[rec.id] = profile.display_name;
            }
          }
          setCustomerNames(map);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setDeals([]);
          return;
        }
        setDealsError(hostErrorText(err, t("Could not load deals.")));
      });
    return () => {
      active = false;
    };
  }, [scope, viewer.operator, committed, stageFilter, reloadNonce, t]);

  const selectedDeal = recordId !== null ? deals.find((d) => d.id === recordId) ?? null : null;

  return (
    <section aria-label={t("Deals list")} className="crm-list crm-list-controls">
      {!viewer.canvas && (
        <h3 tabIndex={-1} className="text-cardtitle font-medium text-ink-100" data-outlet-heading>
          {t("Pipeline")}
        </h3>
      )}
      {stageTotals.length > 0 && (
        <div className="crm-chips" aria-label={t("Pipeline stages")}>
          <button
            type="button"
            className={`chip ${stageFilter === "" ? "crm-chip-on" : ""}`}
            onClick={() => setStageFilter("")}
          >
            {t("All stages")}
          </button>
          {stageTotals.map((agg) => (
            <button
              key={agg.stage}
              type="button"
              className={`chip ${stageFilter === agg.stage ? "crm-chip-on" : ""}`}
              onClick={() => setStageFilter(stageFilter === agg.stage ? "" : agg.stage)}
            >
              {t(STAGE_LABEL[agg.stage])}: {formatNumber(agg.count)} ({formatAmount(agg.amountCents, "HKD")})
            </button>
          ))}
        </div>
      )}
      <div className="crm-toolbar crm-list-toolbar">
        <div className="crm-search">
          <label className="sr-only" htmlFor="crm-deal-search">{t("Search deals")}</label>
          <input
            id="crm-deal-search"
            className="field crm-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={t("Search deals…")}
          />
        </div>
        <div className="crm-filters">
          <Select
            value={stageFilter}
            onChange={(val) => setStageFilter(val as DealStage | "")}
            options={[
              { value: "", label: t("All stages") },
              ...DEAL_STAGES.map((stage) => ({ value: stage, label: t(STAGE_LABEL[stage]) })),
            ]}
            aria-label={t("Filter deals by stage")}
          />
        </div>
        {canWrite && (
          <div className="crm-list-actions">
            <Button variant="primary" className="crm-list-create" onClick={() => onView("new")}>
              {t("New deal")}
            </Button>
          </div>
        )}
      </div>

      {viewer.operator === false && <Notice>{t("You do not have access to customer records.")}</Notice>}
      {viewer.operator && !viewer.canvas && !canWrite && (
        <Notice state="read-only">{t("Read-only view. Record creation and edits are unavailable.")}</Notice>
      )}
      {viewer.operator && listState.loading && deals.length === 0 && !dealsError && (
        <Loading>{t("Loading pipeline…")}</Loading>
      )}
      {viewer.operator && dealsError && (
        <ErrorNotice onRetry={() => setReloadNonce((n) => n + 1)}>{dealsError}</ErrorNotice>
      )}
      {viewer.operator && !dealsError && deals.length === 0 && !listState.loading && (
        <EmptyState name="deals" title={t("No deals yet")}>
          <p>{t("Track revenue opportunities linked to customers across lead, qualified, proposal, won, and lost stages.")}</p>
          {canWrite && (
            <Button variant="primary" onClick={() => onView("new")}>
              {t("New deal")}
            </Button>
          )}
        </EmptyState>
      )}
      {viewer.operator && deals.length > 0 && (
        <>
          <span role="status"><QueryRefresh updating={listState.updating} /></span>
          <DataTable<DealRecord>
            label={t("Pipeline")}
            wrapClassName="crm-table-wrap"
            tableClassName="crm-table"
            rowKey={(deal) => deal.id}
            rows={deals}
            columns={[
              {
                key: "title",
                header: t("Deal"),
                cell: (deal) => (
                  <button type="button" className="lnk" onClick={() => onSelect(deal.id)}>
                    {deal.title}
                  </button>
                ),
              },
              {
                key: "customer",
                header: t("Customer"),
                cell: (deal) => customerNames[deal.customerId] ?? deal.customerId,
              },
              {
                key: "stage",
                header: t("Stage"),
                cell: (deal) => <span className="chip">{t(STAGE_LABEL[deal.stage])}</span>,
              },
              {
                key: "amount",
                header: t("Value"),
                cell: (deal) => <span className="num">{formatAmount(deal.amountCents, deal.currency)}</span>,
              },
              {
                key: "close",
                header: t("Expected close"),
                cell: (deal) => <span className="num">{deal.expectedCloseDate ?? "—"}</span>,
              },
            ]}
          />
        </>
      )}

      {view === "new" && canWrite && (
        <DealFormDrawer
          scope={scope}
          customerNames={customerNames}
          onClose={() => onView("list")}
          onSaved={() => {
            onView("list");
            setReloadNonce((n) => n + 1);
          }}
        />
      )}
      {recordId !== null && selectedDeal !== null && (
        <DealFormDrawer
          scope={scope}
          customerNames={customerNames}
          existing={selectedDeal}
          readOnly={!canWrite}
          onClose={() => onSelect(null)}
          onSaved={() => {
            onSelect(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

function DealFormDrawer({
  scope,
  customerNames,
  existing,
  readOnly = false,
  onClose,
  onSaved,
}: {
  scope: HostScope;
  customerNames: Record<string, string>;
  existing?: DealRecord;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [customerId, setCustomerId] = useState(existing?.customerId ?? Object.keys(customerNames)[0] ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [stage, setStage] = useState<DealStage>(existing?.stage ?? "lead");
  const [amountInput, setAmountInput] = useState(existing ? String(existing.amountCents / 100) : "0");
  const [currency, setCurrency] = useState(existing?.currency ?? "HKD");
  const [closeDate, setCloseDate] = useState(existing?.expectedCloseDate ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    if (pending || readOnly) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError(t("Deal title is required."));
      return;
    }
    if (!existing && !customerId.trim()) {
      setFormError(t("Select a customer for this deal."));
      return;
    }
    const parsedAmount = Number(amountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setFormError(t("Enter a valid deal value."));
      return;
    }
    const amountCents = Math.round(parsedAmount * 100);
    setPending(true);
    setFormError(null);
    try {
      if (existing) {
        await hostActions.updateDeal(scope, existing.id, existing.revision, {
          title: trimmedTitle,
          stage,
          amountCents,
          currency: currency.trim() || "HKD",
          expectedCloseDate: closeDate.trim() || null,
          notes: notes.trim() || null,
        });
      } else {
        await hostActions.createDeal(scope, {
          customerId: customerId.trim(),
          title: trimmedTitle,
          stage,
          amountCents,
          currency: currency.trim() || "HKD",
          expectedCloseDate: closeDate.trim() || null,
          notes: notes.trim() || null,
        });
      }
      onSaved();
    } catch (err: unknown) {
      setFormError(
        isApprovalRequired(err)
          ? t("Waiting for the owner's approval — nothing has changed yet.")
          : hostErrorText(err, t("Could not save deal.")),
      );
    } finally {
      setPending(false);
    }
  };

  const customerOptions = Object.entries(customerNames).map(([id, name]) => ({
    value: id,
    label: `${name} (${id})`,
  }));

  const panel = (
    <div className="crm-list">
      {formError && <ErrorNotice>{formError}</ErrorNotice>}
      {!existing && (
        <Field id="crm-deal-customer" label={t("Customer")}>
          {(c) =>
            customerOptions.length > 0 ? (
              <Select
                {...c}
                value={customerId}
                onChange={setCustomerId}
                options={customerOptions}
                disabled={pending || readOnly}
              />
            ) : (
              <input
                {...c}
                className="field"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={pending || readOnly}
              />
            )
          }
        </Field>
      )}
      <Field id="crm-deal-title" label={t("Deal title")}>
        {(c) => (
          <input
            {...c}
            className="field"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending || readOnly}
          />
        )}
      </Field>
      <div className="crm-field-row flex gap-2">
        <Field id="crm-deal-stage" label={t("Stage")} className="crm-field">
          {(c) => (
            <Select
              {...c}
              value={stage}
              onChange={(val) => setStage(val as DealStage)}
              options={DEAL_STAGES.map((s) => ({ value: s, label: t(STAGE_LABEL[s]) }))}
              disabled={pending || readOnly}
            />
          )}
        </Field>
        <Field id="crm-deal-currency" label={t("Currency")} className="crm-field">
          {(c) => (
            <input
              {...c}
              className="field"
              value={currency}
              maxLength={8}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              disabled={pending || readOnly}
            />
          )}
        </Field>
        <Field id="crm-deal-amount" label={t("Amount")} className="crm-field">
          {(c) => (
            <input
              {...c}
              type="number"
              min="0"
              step="0.01"
              className="field"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={pending || readOnly}
            />
          )}
        </Field>
      </div>
      <Field id="crm-deal-close" label={t("Expected close date")}>
        {(c) => (
          <input
            {...c}
            type="date"
            className="field"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            disabled={pending || readOnly}
          />
        )}
      </Field>
      <Field id="crm-deal-notes" label={t("Notes")}>
        {(c) => (
          <textarea
            {...c}
            className="field"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={pending || readOnly}
          />
        )}
      </Field>
    </div>
  );

  return (
    <FrameDrawer
      kind="deal"
      label={t("Deal")}
      title={existing ? existing.title : t("New deal")}
      tabs={[{ id: "deal", label: t("Deal"), panel }]}
      onClose={onClose}
      secondary={<Button onClick={onClose} disabled={pending}>{t("Close")}</Button>}
      primary={
        !readOnly ? (
          <Button variant="primary" onClick={() => void submit()} disabled={pending}>
            {t(pending ? "Saving…" : existing ? "Save deal" : "Create deal")}
          </Button>
        ) : undefined
      }
    />
  );
}
