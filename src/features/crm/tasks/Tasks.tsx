import { useLocale } from "../locale";
import { ApiError, Button, DataTable, EmptyState, ErrorNotice, Field, Loading, Notice, Select } from "@cadence/screen-ui";
import { useEffect, useState } from "react";
import FrameDrawer from "../FrameDrawer";
import { onScopeRetired } from "../../../bridge/scope";
import { queryPatch, readQueryParams, type QueryParams } from "../../../domain/routeParams";
import { useRouteParams, useRouteParamSync } from "../useRouteParams";
import { QueryRefresh, useCrmQuery } from "../resources";
import {
  TASK_STATUSES,
  hostActions,
  type HostScope,
  type TaskRecord,
  type TaskStatus,
} from "../hostActions";
import { hostErrorText, isApprovalRequired } from "../hostErrors";
import type { Viewer } from "../viewer";

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  done: "Done",
  cancelled: "Cancelled",
};

function isOverdue(task: TaskRecord): boolean {
  if (task.status !== "open" || !task.dueAt) return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.dueAt.slice(0, 10) < today;
}

export default function Tasks({
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
  const { t } = useLocale();
  const routeParams = useRouteParams();
  const [initialParams] = useState(() => readQueryParams(routeParams));
  const [query, setQuery] = useState(initialParams.q);
  const [committed, setCommitted] = useState(initialParams.q);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("open");

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
    { table: "tasks", query: committed || undefined, status: statusFilter || undefined, limit: 100 },
    (raw) => {
      const page = raw as { records?: unknown[] };
      return Array.isArray(page?.records) ? { records: page.records } : { records: [] };
    },
  );
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const canWrite = viewer.operator === true && !viewer.canvas && (viewer.canCreate ?? !viewer.readOnly);

  useEffect(() => {
    if (viewer.operator !== true) return;
    let active = true;
    setTasksError(null);
    void Promise.all([
      hostActions.listTasks(scope, {
        query: committed || undefined,
        status: statusFilter || undefined,
        limit: 100,
      }),
      hostActions.list(scope, { limit: 100 }).catch(() => null),
    ])
      .then(([res, custRes]) => {
        if (!active) return;
        setTasks(res.tasks);
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
          setTasks([]);
          return;
        }
        setTasksError(hostErrorText(err, t("Could not load tasks.")));
      });
    return () => {
      active = false;
    };
  }, [scope, viewer.operator, committed, statusFilter, reloadNonce, t]);

  const markDone = async (task: TaskRecord) => {
    if (!canWrite || busyId !== null) return;
    setBusyId(task.id);
    setTasksError(null);
    try {
      await hostActions.updateTask(scope, task.id, task.revision, { status: "done" });
      setReloadNonce((n) => n + 1);
    } catch (err: unknown) {
      setTasksError(hostErrorText(err, t("Could not update task.")));
    } finally {
      setBusyId(null);
    }
  };

  const selectedTask = recordId !== null ? tasks.find((item) => item.id === recordId) ?? null : null;

  return (
    <section aria-label={t("Tasks list")} className="crm-list crm-list-controls">
      {!viewer.canvas && (
        <h3 tabIndex={-1} className="text-cardtitle font-medium text-ink-100" data-outlet-heading>
          {t("Tasks")}
        </h3>
      )}
      <div className="crm-toolbar crm-list-toolbar">
        <div className="crm-search">
          <label className="sr-only" htmlFor="crm-task-search">{t("Search tasks")}</label>
          <input
            id="crm-task-search"
            className="field crm-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={t("Search tasks…")}
          />
        </div>
        <div className="crm-filters">
          <Select
            value={statusFilter}
            onChange={(val) => setStatusFilter(val as TaskStatus | "")}
            options={[
              { value: "", label: t("All statuses") },
              ...TASK_STATUSES.map((status) => ({ value: status, label: t(STATUS_LABEL[status]) })),
            ]}
            aria-label={t("Filter tasks by status")}
          />
        </div>
        {canWrite && (
          <div className="crm-list-actions">
            <Button variant="primary" className="crm-list-create" onClick={() => onView("new")}>
              {t("New task")}
            </Button>
          </div>
        )}
      </div>

      {viewer.operator === false && <Notice>{t("You do not have access to customer records.")}</Notice>}
      {viewer.operator && !viewer.canvas && !canWrite && (
        <Notice state="read-only">{t("Read-only view. Record creation and edits are unavailable.")}</Notice>
      )}
      {viewer.operator && listState.loading && tasks.length === 0 && !tasksError && (
        <Loading>{t("Loading tasks…")}</Loading>
      )}
      {viewer.operator && tasksError && (
        <ErrorNotice onRetry={() => setReloadNonce((n) => n + 1)}>{tasksError}</ErrorNotice>
      )}
      {viewer.operator && !tasksError && tasks.length === 0 && !listState.loading && (
        <EmptyState name="tasks" title={t("No tasks found")}>
          <p>{t("Keep customer follow-ups, callbacks, and closing steps organized here.")}</p>
          {canWrite && (
            <Button variant="primary" onClick={() => onView("new")}>
              {t("New task")}
            </Button>
          )}
        </EmptyState>
      )}
      {viewer.operator && tasks.length > 0 && (
        <>
          <span role="status"><QueryRefresh updating={listState.updating} /></span>
          <DataTable<TaskRecord>
            label={t("Tasks")}
            wrapClassName="crm-table-wrap"
            tableClassName="crm-table"
            rowKey={(task) => task.id}
            rows={tasks}
            columns={[
              {
                key: "title",
                header: t("Task"),
                cell: (task) => (
                  <button type="button" className="lnk" onClick={() => onSelect(task.id)}>
                    {task.title}
                  </button>
                ),
              },
              {
                key: "customer",
                header: t("Customer"),
                cell: (task) => (task.customerId ? customerNames[task.customerId] ?? task.customerId : "—"),
              },
              {
                key: "status",
                header: t("Status"),
                cell: (task) => (
                  <div className="crm-chips">
                    <span className="chip" data-tone={task.status === "done" ? "ok" : undefined}>
                      {t(STATUS_LABEL[task.status])}
                    </span>
                    {isOverdue(task) && <span className="chip" data-tone="warn">{t("Overdue")}</span>}
                  </div>
                ),
              },
              {
                key: "due",
                header: t("Due date"),
                cell: (task) => <span className="num">{task.dueAt ? task.dueAt.slice(0, 10) : "—"}</span>,
              },
              ...(canWrite
                ? [
                    {
                      key: "action",
                      header: t("Action"),
                      cell: (task: TaskRecord) =>
                        task.status === "open" ? (
                          <Button
                            size="sm"
                            disabled={busyId !== null}
                            onClick={() => void markDone(task)}
                          >
                            {busyId === task.id ? t("Saving…") : t("Mark done")}
                          </Button>
                        ) : (
                          "—"
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}

      {view === "new" && canWrite && (
        <TaskFormDrawer
          scope={scope}
          customerNames={customerNames}
          onClose={() => onView("list")}
          onSaved={() => {
            onView("list");
            setReloadNonce((n) => n + 1);
          }}
        />
      )}
      {recordId !== null && selectedTask !== null && (
        <TaskFormDrawer
          scope={scope}
          customerNames={customerNames}
          existing={selectedTask}
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

function TaskFormDrawer({
  scope,
  customerNames,
  existing,
  readOnly = false,
  onClose,
  onSaved,
}: {
  scope: HostScope;
  customerNames: Record<string, string>;
  existing?: TaskRecord;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [customerId, setCustomerId] = useState(existing?.customerId ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [status, setStatus] = useState<TaskStatus>(existing?.status ?? "open");
  const [dueAt, setDueAt] = useState(existing?.dueAt ? existing.dueAt.slice(0, 10) : "");
  const [assignee, setAssignee] = useState(existing?.assignee ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    if (pending || readOnly) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError(t("Task title is required."));
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      if (existing) {
        await hostActions.updateTask(scope, existing.id, existing.revision, {
          title: trimmedTitle,
          status,
          dueAt: dueAt.trim() || null,
          assignee: assignee.trim() || null,
          notes: notes.trim() || null,
        });
      } else {
        await hostActions.createTask(scope, {
          customerId: customerId.trim() || null,
          title: trimmedTitle,
          status,
          dueAt: dueAt.trim() || null,
          assignee: assignee.trim() || null,
          notes: notes.trim() || null,
        });
      }
      onSaved();
    } catch (err: unknown) {
      setFormError(
        isApprovalRequired(err)
          ? t("Waiting for the owner's approval — nothing has changed yet.")
          : hostErrorText(err, t("Could not save task.")),
      );
    } finally {
      setPending(false);
    }
  };

  const customerOptions = [
    { value: "", label: t("No linked customer") },
    ...Object.entries(customerNames).map(([id, name]) => ({
      value: id,
      label: `${name} (${id})`,
    })),
  ];

  const panel = (
    <div className="crm-list">
      {formError && <ErrorNotice>{formError}</ErrorNotice>}
      {!existing && (
        <Field id="crm-task-customer" label={t("Customer")}>
          {(c) => (
            <Select
              {...c}
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
              disabled={pending || readOnly}
            />
          )}
        </Field>
      )}
      <Field id="crm-task-title" label={t("Task title")}>
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
        <Field id="crm-task-status" label={t("Status")} className="crm-field">
          {(c) => (
            <Select
              {...c}
              value={status}
              onChange={(val) => setStatus(val as TaskStatus)}
              options={TASK_STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL[s]) }))}
              disabled={pending || readOnly}
            />
          )}
        </Field>
        <Field id="crm-task-due" label={t("Due date")} className="crm-field">
          {(c) => (
            <input
              {...c}
              type="date"
              className="field"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={pending || readOnly}
            />
          )}
        </Field>
      </div>
      <Field id="crm-task-assignee" label={t("Assignee")}>
        {(c) => (
          <input
            {...c}
            className="field"
            value={assignee}
            maxLength={120}
            onChange={(e) => setAssignee(e.target.value)}
            disabled={pending || readOnly}
          />
        )}
      </Field>
      <Field id="crm-task-notes" label={t("Notes")}>
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
      kind="task"
      label={t("Task")}
      title={existing ? existing.title : t("New task")}
      tabs={[{ id: "task", label: t("Task"), panel }]}
      onClose={onClose}
      secondary={<Button onClick={onClose} disabled={pending}>{t("Close")}</Button>}
      primary={
        !readOnly ? (
          <Button variant="primary" onClick={() => void submit()} disabled={pending}>
            {t(pending ? "Saving…" : existing ? "Save task" : "Create task")}
          </Button>
        ) : undefined
      }
    />
  );
}
