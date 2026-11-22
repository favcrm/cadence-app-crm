// Declared canvas views and their route params (app-kit 0.8.0, screen-route-params.v1).
// Pure: no React, no bridge. Only filters the lists can already apply are declared.
// A value the list cannot use is ignored, so a bad link opens the unfiltered list.
export type Params = Readonly<Record<string, string>>;

export const CONSENT_VALUES = ["granted", "unknown", "denied"] as const;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const RECORD_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Plain text of 1 to 200 characters with no control characters, else "". */
export const text = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length >= 1 && trimmed.length <= 200 && !CONTROL.test(trimmed) ? trimmed : "";
};

export interface CustomerParams { q: string; consent: string; source: string; tag: string }
export const NO_CUSTOMER_PARAMS: CustomerParams = { q: "", consent: "", source: "", tag: "" };
export interface QueryParams { q: string }

const drop = (entries: [string, string][]): Record<string, string> =>
  Object.fromEntries(entries.filter(([, value]) => value !== ""));

export function readCustomerParams(raw: Params | undefined): CustomerParams {
  const consent = raw?.consent ?? "";
  return {
    q: text(raw?.q),
    consent: (CONSENT_VALUES as readonly string[]).includes(consent) ? consent : "",
    source: text(raw?.source),
    tag: text(raw?.tag),
  };
}
export const customerPatch = (state: CustomerParams): Record<string, string> =>
  drop([["q", text(state.q)], ["consent", readCustomerParams({ consent: state.consent }).consent], ["source", text(state.source)], ["tag", text(state.tag)]]);

export const readQueryParams = (raw: Params | undefined): QueryParams => ({ q: text(raw?.q) });
export const queryPatch = (state: QueryParams): Record<string, string> => drop([["q", text(state.q)]]);

/** The record a `segment` / `campaign` view names, or null. */
export const readRecordParam = (raw: Params | undefined): string | null =>
  raw?.id !== undefined && RECORD_ID.test(raw.id) ? raw.id : null;

export const hasParams = (raw: Params | undefined): boolean => raw !== undefined && Object.keys(raw).length > 0;
