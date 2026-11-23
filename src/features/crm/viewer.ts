// Display affordances only. The native service guard independently proves every operation.
export interface Viewer {
  operator: boolean | null;
  readOnly: boolean;
  canvas?: boolean;
  canCreate?: boolean;
  canUpdate?: boolean;
  canMerge?: boolean;
  access?: "unavailable";
  onRetryAccess?: () => void;
}

/** A record-level decision narrows the host operation grant; it never expands it. */
export function canEditCustomer(viewer: Viewer, record: { recordAccess?: { canWrite: boolean } } | null | undefined): boolean {
  return viewer.operator === true && (viewer.canUpdate ?? !viewer.readOnly) && record != null && record.recordAccess?.canWrite !== false;
}
