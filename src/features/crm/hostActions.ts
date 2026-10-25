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
}

/** One record row as the daemon returns it: identity plus profile. */
export interface HostRecord {
  id: string;
  install_id: string;
  context_id: string;
  kind: string;
  revision: number;
  digest: string;
  profile: unknown;
  history?: unknown;
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
  return {
    id: row.id,
    install_id: typeof row.install_id === "string" ? row.install_id : "",
    context_id: typeof row.context_id === "string" ? row.context_id : "",
    kind: typeof row.kind === "string" ? row.kind : "",
    revision: row.revision as number,
    digest: row.digest,
    profile: row.profile,
    history: row.history,
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

export function parseRecordList(value: unknown): ListReceipt {
  const page = value as { records?: unknown; total?: unknown; truncated?: unknown; next_cursor?: unknown } | null;
  if (!Array.isArray(page?.records)) throw new ApiError("The server returned an invalid app receipt", 502);
  const total = typeof page.total === "number" && Number.isSafeInteger(page.total) && page.total >= page.records.length
    ? page.total : null;
  return {
    records: page.records.map((row) => parseRecord({ record: row })),
    total,
    truncated: page.truncated === true,
    nextCursor: typeof page.next_cursor === "string" ? page.next_cursor : null,
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
  async show(scope: HostScope, recordId: string): Promise<HostRecord> {
    assertRecordId(recordId);
    return parseRecord(await serviceCall<unknown>(scope, "records.show", { record_id: recordId }));
  },
  /** `POST …/records` — body is `{record_id, profile}` plus optional
   *  `consent_provenance` when the new customer is created Granted. */
  async create(
    scope: HostScope,
    recordId: string,
    profile: unknown,
    consentProvenance?: ConsentProvenance,
  ): Promise<HostRecord> {
    assertRecordId(recordId);
    const body: Record<string, unknown> = { record_id: recordId, profile };
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
};
