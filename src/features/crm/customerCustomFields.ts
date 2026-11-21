import { ApiError } from "@cadence/screen-ui";

export type CustomerCustomFieldType = "text" | "number" | "boolean" | "date";
export interface CustomerCustomField {
  label: string;
  type: CustomerCustomFieldType;
  value: string | number | boolean;
}
export type CustomerCustomFields = Record<string, CustomerCustomField>;
export interface CustomerCustomFieldForm {
  key: string;
  label: string;
  type: CustomerCustomFieldType;
  value: string;
}

const FIELD_KEY = /^[a-z0-9_]{1,40}$/;
// Keep these in sync with the host screen DTO redaction and migration 005.
const BRIDGE_RESERVED_KEYS: ReadonlySet<string> = new Set([
  "action_token",
  "confirmation_token",
  "confirmation_nonce",
  "confirm_token",
  "csv_confirm_token",
  "scope_proof",
  "password",
  "credentials",
  "credential",
  "secret",
  "session_key",
  "host_command",
]);
const hasControl = (value: string) => /[\u0000-\u001f\u007f]/.test(value);
const reservedKey = (key: string) => key in Object.prototype || key === "prototype" || BRIDGE_RESERVED_KEYS.has(key);
const validKey = (key: string) => FIELD_KEY.test(key) && !reservedKey(key);
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A missing or malformed collection is unavailable, not an empty collection. */
export function readCustomerCustomFields(profile: unknown): CustomerCustomFields | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const value = (profile as Record<string, unknown>).custom_fields;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) return null;
  const result: CustomerCustomFields = {};
  for (const [key, raw] of entries) {
    if (!validKey(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (
      Object.keys(row).some((name) => !["label", "type", "value"].includes(name)) ||
      typeof row.label !== "string" || row.label.length === 0 || row.label.length > 80 || hasControl(row.label)
    ) return null;
    if (row.type === "text" && typeof row.value === "string" && row.value.length <= 1000) {
      result[key] = { label: row.label, type: row.type, value: row.value };
    } else if (row.type === "number" && typeof row.value === "number" && Number.isFinite(row.value)) {
      result[key] = { label: row.label, type: row.type, value: row.value };
    } else if (row.type === "boolean" && typeof row.value === "boolean") {
      result[key] = { label: row.label, type: row.type, value: row.value };
    } else if (row.type === "date" && typeof row.value === "string" && row.value.length === 10) {
      result[key] = { label: row.label, type: row.type, value: row.value };
    } else return null;
  }
  return result;
}

/** Preserve every other field; the host fences this patch with the customer's revision. */
export function changeCustomerCustomFields(
  fields: CustomerCustomFields,
  existingKey: string | null,
  form: CustomerCustomFieldForm | null,
): { custom_fields: CustomerCustomFields } {
  if (existingKey !== null && !Object.hasOwn(fields, existingKey))
    throw new ApiError("Custom field is no longer available", 400);
  if (form === null && existingKey === null)
    throw new ApiError("Custom field is no longer available", 400);
  const next = { ...fields };
  if (form === null) {
    delete next[existingKey!];
    return { custom_fields: next };
  }
  if (reservedKey(form.key)) throw new ApiError("This field key is reserved", 400);
  if (!validKey(form.key)) throw new ApiError("Field key must use lowercase letters, digits or underscores", 400);
  if (existingKey !== null && form.key !== existingKey) throw new ApiError("Field keys cannot be changed", 400);
  if (existingKey !== null && fields[existingKey]?.type !== form.type) throw new ApiError("Field types cannot be changed", 400);
  if (existingKey === null && Object.hasOwn(next, form.key)) throw new ApiError("Field key already exists", 400);
  if (existingKey === null && Object.keys(next).length >= 64) throw new ApiError("A customer can hold at most 64 custom fields", 400);
  const label = form.label.trim();
  if (!label || label.length > 80 || hasControl(label)) throw new ApiError("Field label is required (1–80 characters)", 400);
  let value: string | number | boolean;
  if (form.type === "text") {
    if (form.value.length > 1000) throw new ApiError("Text must be at most 1000 characters", 400);
    value = form.value;
  } else if (form.type === "number") {
    if (!form.value.trim() || !Number.isFinite(Number(form.value))) throw new ApiError("Enter a valid number", 400);
    value = Number(form.value);
  } else if (form.type === "boolean") {
    if (form.value !== "true" && form.value !== "false") throw new ApiError("Choose yes or no", 400);
    value = form.value === "true";
  } else if (form.type === "date") {
    if (!validDate(form.value)) throw new ApiError("Enter a valid date", 400);
    value = form.value;
  } else throw new ApiError("Choose a valid field type", 400);
  next[form.key] = { label, type: form.type, value };
  return { custom_fields: next };
}
