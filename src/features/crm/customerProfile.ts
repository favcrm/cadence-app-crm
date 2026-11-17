import { ApiError } from "@cadence/screen-ui";
import type { ConsentMethod,ConsentProvenance,HostRecord } from "./hostActions";
import { hostErrorText } from "./hostErrors";
import { readCustomerCustomFields } from "./customerCustomFields";

/**
 * Allowlisted customer profile shaping for the CRM Customers screens
 * (CAD-781). The wire grammar stays exactly `{record_id, profile}` on
 * create and `{expected_revision, profile}` on update — this module
 * only shapes the `profile` value, mirroring the daemon's bounds so
 * refusals explain the field, never the content. No value is ever
 * echoed into an error: every message names the shape.
 */

export type ConsentChoice = "granted" | "denied" | "unknown";
export type CustomerType = "" | "person" | "organization";

export interface CustomerFormFields {
  displayName: string;
  email: string;
  phone: string;
  customerType: CustomerType;
  website: string;
  /** Raw tag text; separators are commas, semicolons or whitespace. */
  tags: string;
  consentEmail: ConsentChoice;
  consentSms: ConsentChoice;
}

export const EMPTY_CUSTOMER_FORM: CustomerFormFields = {
  displayName: "",
  email: "",
  phone: "",
  customerType: "",
  website: "",
  tags: "",
  consentEmail: "unknown",
  consentSms: "unknown",
};

export function isConsentChoice(value: string): value is ConsentChoice {
  return value === "granted" || value === "denied" || value === "unknown";
}

function hasControl(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value);
}

function tagValid(tag: string): boolean {
  return (
    tag.length >= 1 && tag.length <= 40 && /^[A-Za-z0-9_-]+$/.test(tag)
  );
}

/** Split raw tag text; throws a field-named ApiError, never an echo. */
export function parseTags(raw: string): string[] {
  const tags = raw
    .split(/[,\s;]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  if (tags.length > 16) {
    throw new ApiError("Tags hold at most 16 entries", 400);
  }
  for (const tag of tags) {
    if (!tagValid(tag)) {
      throw new ApiError(
        "Tags use letters, digits, dash or underscore (1–40 characters each)",
        400,
      );
    }
  }
  if (new Set(tags).size !== tags.length) {
    throw new ApiError("Tags must not repeat", 400);
  }
  return tags;
}

function emailShapeValid(email: string): boolean {
  if (email.length === 0 || email.length > 254 || hasControl(email)) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [user, domain] = parts;
  return user.length > 0 && domain.length > 0 && domain.includes(".");
}

function phoneShapeValid(phone: string): boolean {
  if (phone.length < 7 || phone.length > 24) return false;
  const digits = phone.replace(/[^0-9]/g, "").length;
  return digits >= 7 && /^[0-9+ \-().]+$/.test(phone);
}

/** Only HTTP(S) addresses without embedded credentials are safe to open. */
export function customerWebsiteHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 ||
      value !== value.trim() || /\s/.test(value) || hasControl(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname &&
      !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

/**
 * Build the allowlisted `profile` value for create/update. Throws a
 * field-named ApiError on the first bad field. Blank optional fields are
 * sent as explicit null so an update clears them (a PATCH never infers
 * clearing from omission). Consent is explicit by construction: the form
 * always sends the operator-visible choice, defaulting to `unknown` —
 * never inferred as granted.
 */
export function buildCustomerProfile(fields: CustomerFormFields): Record<string, unknown> {
  const displayName = fields.displayName;
  if (
    displayName.length === 0 ||
    displayName.length > 120 ||
    displayName.trim() !== displayName ||
    hasControl(displayName)
  ) {
    throw new ApiError("Display name is required (1–120 characters, no surrounding spaces)", 400);
  }
  const email = fields.email.trim();
  if (email !== "" && !emailShapeValid(email)) {
    throw new ApiError("Email needs one @ and a dotted domain", 400);
  }
  const phone = fields.phone.trim();
  if (phone !== "" && !phoneShapeValid(phone)) {
    throw new ApiError("Phone needs at least 7 digits (7–24 characters)", 400);
  }
  if (fields.customerType !== "" && fields.customerType !== "person" && fields.customerType !== "organization") {
    throw new ApiError("Choose a valid customer type", 400);
  }
  const website = fields.website.trim();
  if (website !== "" && customerWebsiteHref(website) === null) {
    throw new ApiError("Website must be an http or https address without credentials", 400);
  }
  const tags = parseTags(fields.tags);
  if (!isConsentChoice(fields.consentEmail) || !isConsentChoice(fields.consentSms)) {
    throw new ApiError("Consent must be granted, denied or unknown", 400);
  }
  const profile: Record<string, unknown> = {
    schema: 1,
    display_name: displayName,
    tags,
    consent: { email: fields.consentEmail, sms: fields.consentSms },
    // Explicit null, never omission: an update is a PATCH, so a blank
    // field must clear the stored value instead of preserving it.
    email: email !== "" ? email : null,
    phone: phone !== "" ? phone : null,
    customer_type: fields.customerType || null,
    website: website || null,
    // Source is platform-managed; omitting it preserves it on a PATCH.
  };
  return profile;
}

/** Contacts share the customer record's visibility; they are not independent customers. */
export interface CustomerContact {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

export interface CustomerContactFields {
  name: string;
  title: string;
  email: string;
  phone: string;
}

/** An absent or malformed collection is unavailable, not an empty collection. */
export function readCustomerContacts(profile: unknown): CustomerContact[] | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const value = (profile as Record<string, unknown>).contacts;
  if (!Array.isArray(value) || value.length > 50) return null;
  const result: CustomerContact[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const contact = row as Record<string, unknown>;
    if (
      Object.keys(contact).some((key) => !["name", "title", "email", "phone"].includes(key)) ||
      typeof contact.name !== "string" || contact.name.length === 0 || contact.name.length > 120 ||
      hasControl(contact.name) ||
      !(contact.title === null || (typeof contact.title === "string" && contact.title.length <= 120 && !hasControl(contact.title))) ||
      !(contact.email === null || (typeof contact.email === "string" && contact.email.length <= 254 && !hasControl(contact.email))) ||
      !(contact.phone === null || (typeof contact.phone === "string" && contact.phone.length <= 24 && !hasControl(contact.phone)))
    ) return null;
    result.push({
      name: contact.name,
      title: contact.title as string | null,
      email: contact.email as string | null,
      phone: contact.phone as string | null,
    });
  }
  return result;
}

/** A contact edit is one revision-fenced patch to the enclosing customer. */
export function changeCustomerContacts(
  contacts: CustomerContact[],
  index: number | null,
  fields: CustomerContactFields | null,
): { contacts: CustomerContact[] } {
  if (index !== null && (!Number.isInteger(index) || index < 0 || index >= contacts.length))
    throw new ApiError("Contact is no longer available", 400);
  if (index === null && (fields === null || contacts.length >= 50))
    throw new ApiError("A customer can hold at most 50 contacts", 400);
  const next = contacts.slice();
  if (fields === null) {
    next.splice(index!, 1);
  } else {
    const name = fields.name.trim();
    const title = fields.title.trim();
    const email = fields.email.trim();
    const phone = fields.phone.trim();
    if (!name || name.length > 120 || hasControl(name))
      throw new ApiError("Contact name is required (1–120 characters)", 400);
    if (title.length > 120 || hasControl(title))
      throw new ApiError("Contact title must be at most 120 characters", 400);
    if (email && !emailShapeValid(email))
      throw new ApiError("Email needs one @ and a dotted domain", 400);
    if (phone && !phoneShapeValid(phone))
      throw new ApiError("Phone needs at least 7 digits (7–24 characters)", 400);
    const contact = { name, title: title || null, email: email || null, phone: phone || null };
    if (index === null) next.push(contact);
    else next[index] = contact;
  }
  return { contacts: next };
}

/** A fresh record id in the peer's segment grammar. Never derived from content. */
export function newCustomerId(): string {
  const bytes = new Uint8Array(9);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `cust-${hex.slice(0, 12)}`;
}

export interface CustomerView {
  displayName: string;
  email: string | null;
  phone: string | null;
  customerType: CustomerType;
  website: string | null;
  tags: string[];
  consentEmail: string;
  consentSms: string | null;
}

/** Defensive read of an untrusted profile value; never throws. */
export function viewProfile(profile: unknown): CustomerView {
  const row =
    profile !== null && typeof profile === "object"
      ? (profile as Record<string, unknown>)
      : {};
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const consent =
    row.consent !== null && typeof row.consent === "object"
      ? (row.consent as Record<string, unknown>)
      : {};
  return {
    displayName: text(row.display_name) ?? "—",
    email: text(row.email),
    phone: text(row.phone),
    customerType: row.customer_type === "person" || row.customer_type === "organization" ? row.customer_type : "",
    website: text(row.website),
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [],
    consentEmail: text(consent.email) ?? "unknown",
    consentSms: text(consent.sms),
  };
}

/** Seed a form from a loaded profile for expected-revision edits. */
export function formFromProfile(profile: unknown): CustomerFormFields {
  const view = viewProfile(profile);
  return {
    displayName: view.displayName === "—" ? "" : view.displayName,
    email: view.email ?? "",
    phone: view.phone ?? "",
    customerType: view.customerType,
    website: view.website ?? "",
    tags: view.tags.join(", "),
    consentEmail: isConsentChoice(view.consentEmail) ? view.consentEmail : "unknown",
    consentSms: view.consentSms !== null && isConsentChoice(view.consentSms) ? view.consentSms : "unknown",
  };
}


export interface ConsentEntry {
  revision: number;
  channel: string;
  state: string;
  actor: string;
  at: number;
  method?: string;
  note?: string;
}

export const CONSENT_METHODS: { value: ConsentMethod; label: string }[] = [
  { value: "in_person", label: "In person (counter / event)" },
  { value: "web_form", label: "Website form" },
  { value: "written", label: "Written / email reply" },
  { value: "imported", label: "Imported list (source noted)" },
  { value: "other", label: "Other" },
];
export const CONSENT_NOTE_MAX = 280;

export type ConsentSetting = "granted" | "unknown" | "denied";

/** Operator wording: the stored `denied` state reads as withdrawn. */
type Translate = (english: string) => string;
const identity: Translate = (english) => english;

export function consentLabel(state: string | null, t: Translate = identity): string {
  if (state === "granted") return t("Granted");
  if (state === "denied") return t("Withdrawn");
  return t("Unknown");
}

/**
 * Build the update for the Record consent form: the loaded profile with
 * only its consent replaced, plus the provenance. Granting a channel
 * needs a method; withdrawing only needs one when a note is recorded.
 * Throws a field-named ApiError, never an echo of the note.
 */
export function buildConsentChange(
  profile: unknown,
  next: { email: ConsentSetting; sms: ConsentSetting; method: ConsentMethod | ""; note: string },
): { profile: Record<string, unknown>; provenance: ConsentProvenance | null } {
  const view = viewProfile(profile);
  const was = { email: view.consentEmail, sms: view.consentSms ?? "unknown" };
  const changed = next.email !== was.email || next.sms !== was.sms;
  if (!changed) throw new ApiError("Change at least one consent setting", 400);
  const granting =
    (next.email === "granted" && was.email !== "granted") ||
    (next.sms === "granted" && was.sms !== "granted");
  const note = next.note.trim();
  if (note.length > CONSENT_NOTE_MAX || hasControl(note)) {
    throw new ApiError("Note is at most 280 characters", 400);
  }
  if (granting && next.method === "") {
    throw new ApiError("Say how consent was given", 400);
  }
  if (note !== "" && next.method === "") {
    throw new ApiError("Choose how this consent was recorded to save the note", 400);
  }
  const base = formFromProfile(profile);
  const built = buildCustomerProfile({ ...base, consentEmail: next.email, consentSms: next.sms });
  const provenance: ConsentProvenance | null =
    next.method === "" ? null : { method: next.method, ...(note !== "" ? { note } : {}) };
  return { profile: built, provenance };
}

/** Create-time provenance: optional. A note needs a method to describe. */
export function buildCreateProvenance(method: ConsentMethod | "", rawNote: string): ConsentProvenance | null {
  const note = rawNote.trim();
  if (note.length > CONSENT_NOTE_MAX || hasControl(note)) {
    throw new ApiError("Note is at most 280 characters", 400);
  }
  if (note !== "" && method === "") {
    throw new ApiError("Choose how this consent was recorded to save the note", 400);
  }
  return method === "" ? null : { method, ...(note !== "" ? { note } : {}) };
}

export interface ActivityItem {
  key: string;
  text: string;
  note?: string;
  at: number;
  kind: "note" | "revision" | "consent";
  actor: string;
  revision?: number;
  changes?: { field: string; before: string; after: string }[];
}

/** Compare only fields the current profile and both journal snapshots actually expose. */
function activityChanges(before: unknown, after: unknown, current: unknown, t: Translate): NonNullable<ActivityItem["changes"]> {
  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  const previous = object(before);
  const next = object(after);
  const visible = object(current);
  if (!previous || !next || !visible) return [];
  const changes: NonNullable<ActivityItem["changes"]> = [];
  const add = (field: string, left: string | undefined, right: string | undefined) => {
    if (left !== undefined && right !== undefined && left !== right) {
      changes.push({ field: t(field), before: left, after: right });
    }
  };
  const text = (value: unknown): string | undefined =>
    value === null || value === "" ? t("Not provided") : typeof value === "string" ? value : undefined;
  for (const [key, label] of [["display_name", "Display name"], ["email", "Email"], ["phone", "Phone"], ["website", "Website"]] as const) {
    if (Object.hasOwn(visible, key) && Object.hasOwn(previous, key) && Object.hasOwn(next, key)) {
      add(label, text(previous[key]), text(next[key]));
    }
  }
  const customerType = (value: unknown): string | undefined =>
    value === null ? t("Not provided")
      : value === "person" ? t("Person")
        : value === "organization" ? t("Organization") : undefined;
  if (Object.hasOwn(visible, "customer_type") && Object.hasOwn(previous, "customer_type") && Object.hasOwn(next, "customer_type")) {
    add("Customer type", customerType(previous.customer_type), customerType(next.customer_type));
  }
  const tags = (value: unknown): string | undefined =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value.length === 0 ? t("Not provided") : value.join(", ")
      : undefined;
  if (Object.hasOwn(visible, "tags") && Object.hasOwn(previous, "tags") && Object.hasOwn(next, "tags")) {
    add("Tags", tags(previous.tags), tags(next.tags));
  }
  const contactSummary = (value: unknown): string | undefined => {
    const rows = readCustomerContacts({ contacts: value });
    if (rows === null) return undefined;
    return rows.length === 0
      ? t("Not provided")
      : rows.map((row) => [row.name, row.title, row.email, row.phone].filter(Boolean).join(" · ")).join("\n");
  };
  if (Object.hasOwn(visible, "contacts") && Object.hasOwn(previous, "contacts") && Object.hasOwn(next, "contacts")) {
    add("Contacts", contactSummary(previous.contacts), contactSummary(next.contacts));
  }
  const customSummary = (value: unknown): string | undefined => {
    const fields = readCustomerCustomFields({ custom_fields: value });
    if (fields === null) return undefined;
    const entries = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));
    return entries.length === 0
      ? t("Not provided")
      : entries.map(([key, field]) => `${field.label} (${key}): ${field.type === "boolean" ? t(field.value ? "Yes" : "No") : String(field.value)}`).join("\n");
  };
  if (Object.hasOwn(visible, "custom_fields") && Object.hasOwn(previous, "custom_fields") && Object.hasOwn(next, "custom_fields")) {
    add("Custom fields", customSummary(previous.custom_fields), customSummary(next.custom_fields));
  }
  const visibleConsent = object(visible.consent);
  const previousConsent = object(previous.consent);
  const nextConsent = object(next.consent);
  const consent = (value: unknown): string | undefined =>
    value === null || value === "unknown" || value === "granted" || value === "denied"
      ? consentLabel(value, t)
      : undefined;
  if (visibleConsent && previousConsent && nextConsent) {
    for (const [channel, label] of [["email", "Email marketing"], ["sms", "SMS marketing"]] as const) {
      if (Object.hasOwn(visibleConsent, channel) && Object.hasOwn(previousConsent, channel) && Object.hasOwn(nextConsent, channel)) {
        add(label, consent(previousConsent[channel]), consent(nextConsent[channel]));
      }
    }
  }
  return changes;
}

function activityConsentText(entry: ConsentEntry, t: Translate): string {
  const channel = t(entry.channel === "sms" ? "SMS" : "Email");
  const method = entry.method
    ? t(
        entry.method === "in_person" ? "in person"
          : entry.method === "web_form" ? "on the website form"
            : entry.method === "written" ? "in writing"
              : entry.method === "imported" ? "from an imported list"
                : entry.method === "other" ? "another way" : "",
      )
    : "";
  return entry.state === "granted"
    ? method === ""
      ? t("{channel} consent granted").replace("{channel}", () => channel)
      : t("{channel} consent granted ({method})").replace("{channel}", () => channel).replace("{method}", () => method)
    : entry.state === "denied"
      ? t("{channel} consent withdrawn").replace("{channel}", () => channel)
      : t("{channel} consent recorded as {state}").replace("{channel}", () => channel).replace("{state}", () => t(entry.state));
}

/** Each journal row stays distinct even when a restore reuses revision numbers. */
export function activityItems(record: HostRecord, t: Translate = identity): ActivityItem[] {
  const explicit = explicitConsentEntries(record);
  const revisions: ActivityItem[] = [];
  if (Array.isArray(record.history)) {
    record.history.forEach((item, index) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return;
      const row = item as Record<string, unknown>;
      if (
        typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
        typeof row.digest !== "string" || typeof row.actor !== "string" ||
        typeof row.at !== "number" || !Number.isFinite(row.at)
      ) return;
      const here = explicit.length === 0 ? genericConsentEntriesForRow(row) : [];
      const parts = here.map((entry) => activityConsentText(entry, t));
      const who = row.actor === "operator" ? t("the operator") : row.actor;
      const created = row.operation === "create" || (row.operation === undefined && row.revision === 1);
      const lead = created ? t("Created") : parts.length === 0 ? t("Profile edited") : "";
      const text = [lead, ...parts].filter(Boolean).join(" · ") + ` ${t("by {who}").replace("{who}", () => who)}`;
      const note = here.find((entry) => entry.note)?.note;
      const changes = activityChanges(row.before, row.after, record.profile, t);
      revisions.push({
        key: `r:${index}`, text, ...(note ? { note } : {}),
        ...(changes.length > 0 ? { changes } : {}), at: row.at,
        kind: "revision", actor: row.actor, revision: row.revision,
      });
    });
  }
  // Explicit consent records are independent evidence. A revision number can
  // repeat after restore, so never attach one to a journal row by revision.
  const consent: ActivityItem[] = explicit.map((entry, index) => {
    const who = entry.actor === "operator" ? t("the operator") : entry.actor;
    return {
      key: `c:${index}`,
      text: `${activityConsentText(entry, t)} ${t("by {who}").replace("{who}", () => who)}`,
      ...(entry.note ? { note: entry.note } : {}),
      at: entry.at, kind: "consent", actor: entry.actor, revision: entry.revision,
    };
  });
  const notes: ActivityItem[] = (record.notes ?? []).map((note) => ({
    key: `n:${note.id}`,
    text: `${t("Note")}: ${note.body}`,
    at: note.created,
    kind: "note",
    actor: note.actor,
  }));
  return [...notes, ...consent, ...revisions].sort((a, b) => b.at - a.at);
}

function explicitConsentEntries(record: HostRecord): ConsentEntry[] {
  if (!Array.isArray(record.consentHistory)) return [];
  const entries: ConsentEntry[] = [];
  for (const item of record.consentHistory) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.revision !== "number" ||
      typeof row.channel !== "string" ||
      typeof row.state !== "string" ||
      typeof row.actor !== "string" ||
      typeof row.at !== "number"
    ) {
      continue;
    }
    entries.push({
      revision: row.revision,
      channel: row.channel,
      state: row.state,
      actor: row.actor,
      at: row.at,
      ...(typeof row.method === "string" ? { method: row.method } : {}),
      ...(typeof row.note === "string" ? { note: row.note } : {}),
    });
  }
  return entries.sort((a, b) => a.revision - b.revision);
}

/** The reported state for one channel in a generic before/after value map. */
function genericConsentState(values: unknown, channel: "email" | "sms"): string | null {
  if (values === null || typeof values !== "object") return null;
  const consent = (values as Record<string, unknown>).consent;
  if (consent === null || typeof consent !== "object") return null;
  const value = (consent as Record<string, unknown>)[channel];
  if (typeof value === "string") return value;
  return value === null ? "unknown" : null;
}

/**
 * Project the generic record journal into the consent timeline when the
 * host reports no explicit consent_history. Provenance stays reported
 * metadata, never proof of consent; the app never infers a grant.
 */
function genericConsentEntriesForRow(item: unknown): ConsentEntry[] {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
  const row = item as Record<string, unknown>;
  if (
    typeof row.revision !== "number" ||
    typeof row.actor !== "string" ||
    typeof row.at !== "number" ||
    row.after === null ||
    typeof row.after !== "object"
  ) return [];
  const entries: ConsentEntry[] = [];
  const provenance =
    row.provenance !== null && typeof row.provenance === "object"
      ? (row.provenance as Record<string, unknown>)
      : null;
  const created = row.before === null || row.before === undefined;
  for (const channel of ["email", "sms"] as const) {
    const next = genericConsentState(row.after, channel);
    if (next === null) continue;
    const previous = genericConsentState(row.before, channel) ?? "unknown";
    if (!created && previous === next) continue;
    entries.push({
      revision: row.revision,
      channel,
      state: next,
      actor: row.actor,
      at: row.at,
      ...(provenance && typeof provenance.method === "string" ? { method: provenance.method } : {}),
      ...(provenance && typeof provenance.note === "string" ? { note: provenance.note } : {}),
    });
  }
  return entries;
}

function genericConsentEntries(record: HostRecord): ConsentEntry[] {
  if (!Array.isArray(record.history)) return [];
  return record.history.flatMap(genericConsentEntriesForRow).sort((a, b) => a.revision - b.revision);
}

/** Per-channel consent/suppression transitions; malformed entries are dropped.
 *  A real explicit `consent_history` wins; otherwise the generic journal is
 *  projected (the host deliberately reports no derived consent semantics). */
export function consentEntries(record: HostRecord): ConsentEntry[] {
  const explicit = explicitConsentEntries(record);
  if (explicit.length > 0) return explicit;
  return genericConsentEntries(record);
}

/**
 * Operator-facing copy for a peer refusal. Server messages are generic
 * by design and safe to show; known shapes gain a next step. The input
 * value never appears here.
 */
export function friendlyError(error: unknown, t: Translate = identity): string {
  const message = hostErrorText(error, "The customer request was refused — retry.");
  if (/stale|expected_revision|expected record revision/i.test(message)) {
    return `${message} ${t("— someone else saved this record first. Reload and reapply your change.")}`;
  }
  if (/already holds different content|already used by another record/i.test(message)) {
    return `${message} ${t("— pick a different id or address, or open the existing record.")}`;
  }
  if (/supported shape or bounds/i.test(message)) {
    return `${message} ${t("— check the customer fields against the field hints.")}`;
  }
  if (/refused app record field/i.test(message)) {
    return `${message} ${t("— the client refused a field the server never accepts.")}`;
  }
  return message;
}
