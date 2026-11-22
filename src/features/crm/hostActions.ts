import { ApiError } from "@cadence/screen-ui";
import { serviceCall } from "../../bridge/services";

/**
 * Typed host action client for installed-App record screens (CAD-802).
 *
 * The installation, context and record IDs always come from the trusted
 * route/scope — never from a form field, a chat message or a stored
 * draft. Request bodies carry only the operator-checked grammar the
 * HTTP peer accepts (`record_id` + `profile` on create,
 * `expected_revision` + `profile` on update); anything else throws
 * client-side before a byte is sent, and the server's
 * `deny_unknown_fields` refuses it again. No actor claims, SQL, App
 * database paths, provider secrets or project links ever enter this
 * client. Authority stays server-checked (CAD-768); the selected record
 * is context for a turn, never proof of access.
 */

/** Bounded list selectors for `GET …/records` (CAD-781). The search
 *  text never enters the URL of the App shell route — it travels only
 *  in this peer request — so no customer content lands in history. */
export interface ListOptions {
  query?: string;
  limit?: number;
  cursor?: string;
}

/** One page of server rows with its continuation cursor and the host's
 *  count of matching rows before paging (`total`). Older hosts omit the
 *  count; then no page total is claimed. */
export interface ListReceipt {
  records: HostRecord[];
  total: number | null;
  truncated: boolean;
  nextCursor: string | null;
  hostAssignedCreateId: boolean;
}

/** One record row as the daemon returns it: identity plus profile. */
export interface HostRecord {
  id: string;
  install_id: string;
  context_id: string;
  kind: string;
  revision: number;
  digest: string;
  recordAccess?: { canWrite: boolean };
  profile: unknown;
  history?: unknown;
  historyTruncated?: boolean;
  historyNextCursor?: string;
  consentHistory?: unknown;
  notes?: CustomerNote[];
}

/** A plain-text note on a customer timeline. Notes never change the
 *  profile digest, a segment or a frozen audience. */
export interface CustomerNote {
  id: string;
  recordId: string;
  body: string;
  actor: string;
  created: number;
}

/** App-owned customer note stored in `table: "notes"` (schema v6). */
export interface CustomerNoteRecord {
  id: string;
  revision: number;
  customerId: string;
  body: string;
  archivedAt: string | null;
}

/** How consent was given (CAD-1053). Granting requires one; the note is optional (≤280). */
export type ConsentMethod = "in_person" | "web_form" | "written" | "imported" | "other";
export interface ConsentProvenance {
  method: ConsentMethod;
  note?: string;
}

/** URL-bound scope: the only identity this client will use. */
export interface HostScope {
  installId: string;
  digest: string;
}

/** Body keys the HTTP peer accepts. Everything else is forged. */
const CREATE_KEYS = ["record_id", "profile", "consent_provenance"] as const;
const UPDATE_KEYS = ["expected_revision", "profile", "consent_provenance"] as const;

/** Authority-claiming fields that must never travel from the browser. */
const ALWAYS_FORBIDDEN = [
  "by",
  "actor",
  "workspace",
  "project",
  "project_link",
  "sql",
  "path",
  "secret",
] as const;

/** URL-identity fields: only the operation's own grammar may carry them
 *  (`record_id` on create); anywhere else they are forged. */
const URL_IDENTITY_KEYS = ["install_id", "context_id", "record_id"] as const;

/** Every field this client refuses outside the operation's grammar. */
export const FORBIDDEN_BODY_KEYS = [...ALWAYS_FORBIDDEN, ...URL_IDENTITY_KEYS] as const;

function segment(id: string): boolean {
  return id.length >= 1 && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id);
}

/** The same segment grammar the HTTP peer enforces — refuse early. */
export function assertScope(scope: HostScope): void {
  if (!segment(scope.installId)) {
    throw new ApiError("invalid installation scope", 400);
  }
}

export function assertRecordId(recordId: string): void {
  if (!segment(recordId)) throw new ApiError("invalid record id", 400);
}

/** Defense in depth: unknown or authority-claiming keys never serialize. */
export function assertCleanBody(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (
      !allowed.includes(key) ||
      (ALWAYS_FORBIDDEN as readonly string[]).includes(key)
    ) {
      throw new ApiError(`refused app record field: ${key}`, 400);
    }
  }
}

export function parseRecord(value: unknown): HostRecord {
  const record = (value as { record?: unknown } | null)?.record;
  if (!record || typeof record !== "object") throw new ApiError("The server returned an invalid app receipt", 502);
  const row = record as Record<string, unknown>;
  if (typeof row.id !== "string" || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1 || typeof row.digest !== "string") {
    throw new ApiError("The server returned an invalid app receipt", 502);
  }
  const access = row.record_access;
  if (Object.hasOwn(row, "record_access") && (
    access === null || typeof access !== "object" || Array.isArray(access) ||
    typeof (access as Record<string, unknown>).can_write !== "boolean"
  )) throw new ApiError("The server returned an invalid record access decision", 502);
  const historyTruncated = row.history_truncated;
  if (Object.hasOwn(row, "history_truncated") && typeof historyTruncated !== "boolean") {
    throw new ApiError("The server returned an invalid history decision", 502);
  }
  const historyNextCursor = row.history_next_cursor;
  if (Object.hasOwn(row, "history_next_cursor") && (
    typeof historyNextCursor !== "string" || !/^[a-f0-9]{32}$/.test(historyNextCursor) ||
    historyTruncated !== true || !Array.isArray(row.history) || row.history.length === 0
  )) throw new ApiError("The server returned an invalid history cursor", 502);
  return {
    id: row.id,
    install_id: typeof row.install_id === "string" ? row.install_id : "",
    context_id: typeof row.context_id === "string" ? row.context_id : "",
    kind: typeof row.kind === "string" ? row.kind : "",
    revision: row.revision as number,
    digest: row.digest,
    ...(access === undefined ? {} : { recordAccess: { canWrite: (access as { can_write: boolean }).can_write } }),
    profile: row.profile,
    history: row.history,
    ...(typeof historyTruncated === "boolean" ? { historyTruncated } : {}),
    ...(typeof historyNextCursor === "string" ? { historyNextCursor } : {}),
    consentHistory: (row as Record<string, unknown>).consent_history,
    notes: Array.isArray(row.notes)
      ? row.notes.flatMap((item): CustomerNote[] => {
          if (item === null || typeof item !== "object") return [];
          const note = item as Record<string, unknown>;
          if (
            typeof note.id !== "string" ||
            typeof note.record_id !== "string" ||
            typeof note.body !== "string" ||
            typeof note.actor !== "string" ||
            typeof note.created !== "number"
          ) return [];
          return [{ id: note.id, recordId: note.record_id, body: note.body, actor: note.actor, created: note.created }];
        })
      : [],
  };
}

/** Never combine pages from different records, revisions or access decisions. */
export function appendHistoryPage(current: HostRecord, page: HostRecord): HostRecord {
  if (
    !current.historyNextCursor || !Array.isArray(current.history) || !Array.isArray(page.history) ||
    page.id !== current.id || page.install_id !== current.install_id ||
    page.context_id !== current.context_id || page.kind !== current.kind ||
    page.revision !== current.revision || page.digest !== current.digest ||
    page.recordAccess?.canWrite !== current.recordAccess?.canWrite ||
    typeof page.historyTruncated !== "boolean" ||
    page.historyNextCursor === current.historyNextCursor
  ) throw new ApiError("Customer changed while loading activity; reload it.", 409, { code: "record_changed" });
  return {
    ...current,
    history: [...current.history, ...page.history],
    historyTruncated: page.historyTruncated,
    historyNextCursor: page.historyNextCursor,
  };
}

export function parseRecordList(value: unknown): ListReceipt {
  const page = value as { records?: unknown; total?: unknown; truncated?: unknown; next_cursor?: unknown; record_access?: unknown } | null;
  if (!Array.isArray(page?.records)) throw new ApiError("The server returned an invalid app receipt", 502);
  const access = page.record_access;
  if (Object.hasOwn(page, "record_access") && (
    access === null || typeof access !== "object" || Array.isArray(access) ||
    (access as Record<string, unknown>).create_id !== "host"
  )) throw new ApiError("The server returned an invalid customer creation policy", 502);
  const total = typeof page.total === "number" && Number.isSafeInteger(page.total) && page.total >= page.records.length
    ? page.total : null;
  return {
    records: page.records.map((row) => parseRecord({ record: row })),
    total,
    truncated: page.truncated === true,
    nextCursor: typeof page.next_cursor === "string" ? page.next_cursor : null,
    hostAssignedCreateId: access !== undefined,
  };
}

export function parseNoteRecord(row: unknown): CustomerNoteRecord {
  if (!row || typeof row !== "object") throw new ApiError("The server returned an invalid customer note", 502);
  const item = row as Record<string, unknown>;
  const profile = item.profile;
  if (
    typeof item.id !== "string" ||
    typeof item.revision !== "number" ||
    !Number.isSafeInteger(item.revision) ||
    item.revision < 1 ||
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile)
  ) {
    throw new ApiError("The server returned an invalid customer note", 502);
  }
  const fields = profile as Record<string, unknown>;
  if (typeof fields.customer_id !== "string" || typeof fields.body !== "string") {
    throw new ApiError("The server returned an invalid customer note", 502);
  }
  const archived = fields.archived_at;
  if (archived !== undefined && archived !== null && typeof archived !== "string") {
    throw new ApiError("The server returned an invalid customer note", 502);
  }
  return {
    id: item.id,
    revision: item.revision,
    customerId: fields.customer_id,
    body: fields.body,
    archivedAt: archived ?? null,
  };
}

export const hostActions = {
  guards: { assertScope, assertRecordId, assertCleanBody },
  /** `GET …/records` — the server scopes rows to the URL's install/context.
   *  Selectors travel as a bounded query string on the peer request only:
   *  the App shell route URL keeps scope (`ctx`, `record`) and never
   *  customer content. Older receipts without a page envelope read as
   *  one complete page. */
  async list(scope: HostScope, opts?: ListOptions): Promise<ListReceipt> {
    if (opts?.query !== undefined) {
      if (
        opts.query.length === 0 ||
        opts.query.length > 120 ||
        /[\u0000-\u001f\u007f]/.test(opts.query)
      ) {
        throw new ApiError("record search query is out of bounds", 400);
      }
    }
    if (opts?.limit !== undefined) {
      if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 100) {
        throw new ApiError("record page limit is out of bounds", 400);
      }
    }
    if (opts?.cursor !== undefined) {
      assertRecordId(opts.cursor);
    }
    const value = await serviceCall<{ records: unknown; truncated?: unknown; next_cursor?: unknown }>(
      scope, "records.list", { ...opts },
    );
    return parseRecordList(value);
  },
  /** `GET …/records/:id` — one row under the same URL scope. */
  async show(scope: HostScope, recordId: string, historyCursor?: string): Promise<HostRecord> {
    assertRecordId(recordId);
    if (historyCursor !== undefined && !/^[a-f0-9]{32}$/.test(historyCursor)) {
      throw new ApiError("invalid history cursor", 400);
    }
    return parseRecord(await serviceCall<unknown>(scope, "records.show", {
      record_id: recordId, ...(historyCursor === undefined ? {} : { history_cursor: historyCursor }),
    }));
  },
  /** On supporting hosts the record ID is allocated by the host. */
  async create(
    scope: HostScope,
    recordId: string | null,
    profile: unknown,
    consentProvenance?: ConsentProvenance,
  ): Promise<HostRecord> {
    if (recordId !== null) assertRecordId(recordId);
    const body: Record<string, unknown> = { ...(recordId === null ? {} : { record_id: recordId }), profile };
    if (consentProvenance !== undefined) body.consent_provenance = consentProvenance;
    assertCleanBody(body, CREATE_KEYS);
    return parseRecord(await serviceCall<unknown>(scope, "records.create", body));
  },
  /** `POST …/records/:id/update` — body is `{expected_revision, profile}` plus
   *  `consent_provenance` only on a consent change. */
  async update(
    scope: HostScope,
    recordId: string,
    expectedRevision: number,
    profile: unknown,
    consentProvenance?: ConsentProvenance,
  ): Promise<HostRecord> {
    if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) {
      throw new ApiError("expected record revision must be a positive integer", 400);
    }
    const body: Record<string, unknown> = { expected_revision: expectedRevision, profile };
    if (consentProvenance !== undefined) body.consent_provenance = consentProvenance;
    assertCleanBody(body, UPDATE_KEYS);
    return parseRecord(await serviceCall<unknown>(scope, "records.update", { record_id: recordId, ...body }));
  },
  async listNotes(scope: HostScope, customerId: string): Promise<CustomerNoteRecord[]> {
    assertRecordId(customerId);
    const value = await serviceCall<{ records?: unknown }>(scope, "records.list", {
      table: "notes",
      filters: [{ field: "customer_id", op: "eq", value: customerId }],
      limit: 100,
    });
    if (!Array.isArray(value?.records)) {
      throw new ApiError("The server returned an invalid customer notes receipt", 502);
    }
    return value.records.map(parseNoteRecord).filter((note) => note.archivedAt === null);
  },
  async createNote(
    scope: HostScope,
    customerId: string,
    bodyText: string,
    noteId?: string,
  ): Promise<CustomerNoteRecord> {
    assertRecordId(customerId);
    const trimmed = bodyText.trim();
    if (trimmed.length === 0 || trimmed.length > 4000) {
      throw new ApiError("Note must be 1–4000 characters", 400);
    }
    const id = noteId ?? `note-${crypto.randomUUID()}`;
    assertRecordId(id);
    const value = await serviceCall<{ record?: unknown }>(scope, "records.create", {
      table: "notes",
      record_id: id,
      profile: { customer_id: customerId, body: trimmed },
    });
    return parseNoteRecord(value?.record);
  },
  async archiveNote(
    scope: HostScope,
    noteId: string,
    expectedRevision: number,
    archivedAt = new Date().toISOString(),
  ): Promise<CustomerNoteRecord> {
    assertRecordId(noteId);
    if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) {
      throw new ApiError("expected record revision must be a positive integer", 400);
    }
    const value = await serviceCall<{ record?: unknown }>(scope, "records.update", {
      table: "notes",
      record_id: noteId,
      expected_revision: expectedRevision,
      profile: { archived_at: archivedAt },
    });
    return parseNoteRecord(value?.record);
  },
};
