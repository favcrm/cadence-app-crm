import type { ReactNode } from "react";
import { useLocale } from "./locale";

export default function WorkspaceTabs<Id extends string>({
  idPrefix,
  label,
  tabs,
  active,
  onChange,
  actions,
  disabled = false,
  children,
}: {
  idPrefix: string;
  label: string;
  tabs: readonly { id: Id; label: string; badge?: string | null }[];
  active: Id;
  onChange: (tab: Id) => void;
  actions?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className="crm-ctabs-bar">
        <div className="crm-ctabs" role="tablist" aria-label={t(label)}>
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`${idPrefix}-tab-${tab.id}`}
              type="button"
              role="tab"
              className="crm-ctab"
              data-tab={tab.id}
              aria-selected={active === tab.id}
              aria-controls={active === tab.id ? `${idPrefix}-panel-${tab.id}` : undefined}
              tabIndex={active === tab.id ? 0 : -1}
              aria-disabled={disabled || undefined}
              onClick={() => { if (!disabled) onChange(tab.id); }}
              onKeyDown={(event) => {
                if (disabled) return;
                const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home" ? 0
                  : event.key === "End" ? tabs.length - 1
                  : -1;
                if (next < 0) return;
                event.preventDefault();
                const target = tabs[next]!.id;
                onChange(target);
                event.currentTarget.ownerDocument.getElementById(`${idPrefix}-tab-${target}`)?.focus();
              }}
            >
              {t(tab.label)}
              {tab.badge ? <span className="chip">{t(tab.badge)}</span> : null}
            </button>
          ))}
        </div>
        {actions !== undefined && <div className="crm-ctabs-action">{actions}</div>}
      </div>
      <div
        id={`${idPrefix}-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${active}`}
        tabIndex={0}
        className="grid gap-3"
        data-panel={active}
      >
        {children}
      </div>
    </>
  );
}
