import WorkspaceTabs from "../WorkspaceTabs";
import type { ReactNode } from "react";
import type { CampaignTab } from "./readiness";

export interface TabSpec {
  id: CampaignTab;
  label: string;
  /** A short status pill next to the label (e.g. "1 draft"). */
  badge?: string | null;
}

/**
 * The saved campaign's tablist (CAD-1055). Only the active panel is
 * mounted; Left/Right/Home/End move between tabs (roving tabindex).
 */
export default function CampaignTabs({
  tabs,
  active,
  onChange,
  actions,
  disabled = false,
  children,
}: {
  tabs: TabSpec[];
  active: CampaignTab;
  onChange: (tab: CampaignTab) => void;
  /** One compact action aligned with the tab row (e.g. Clone). */
  actions?: ReactNode;
  /** A send is running: staying on this tab keeps what it was started for true. */
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <WorkspaceTabs
      idPrefix="cmp"
      label="Campaign sections"
      tabs={tabs}
      active={active}
      onChange={onChange}
      actions={actions}
      disabled={disabled}
    >
      {children}
    </WorkspaceTabs>
  );
}
