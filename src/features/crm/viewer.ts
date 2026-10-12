// Display affordances only. The native service guard independently proves every operation.
export interface Viewer { operator: boolean | null; readOnly: boolean; access?: "unavailable"; onRetryAccess?: () => void }
