// Declared canvas views and their route params (app-kit 0.8.0, screen-route-params.v1).
// Pure: no React, no bridge. Only filters the lists can already apply are declared.
// A value the list cannot use is ignored, so a bad link opens the unfiltered list.
export type Params = Readonly<Record<string, string>>;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const RECORD_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Plain text of 1 to 200 characters with no control characters, else "". */
export const text = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length >= 1 && trimmed.length <= 200 && !CONTROL.test(trimmed) ? trimmed : "";
};

// Every list's one param is `q`. Customers' `q` is the server search (name, email or tag, so it
// reaches the whole list); records.list takes no field filter, so consent, source and tag are not params.
export interface QueryParams { q: string }
export const readQueryParams = (raw: Params | undefined): QueryParams => ({ q: text(raw?.q) });
export const queryPatch = (state: QueryParams): Record<string, string> => { const q = text(state.q); return q === "" ? {} : { q }; };

/** The record a `segment` / `campaign` view names, or null. */
export const readRecordParam = (raw: Params | undefined): string | null =>
  raw?.id !== undefined && RECORD_ID.test(raw.id) ? raw.id : null;

export const hasParams = (raw: Params | undefined): boolean => raw !== undefined && Object.keys(raw).length > 0;
