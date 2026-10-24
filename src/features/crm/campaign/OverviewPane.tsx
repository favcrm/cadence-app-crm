import { useLocale } from "../locale";
import { Button,Link } from "@cadence/screen-ui";
import type { ContentDoc } from "../campaignGrammar";
import type { SmtpBinding } from "../sendClient";
import { EMAIL_SENDING_HREF,isHostedTransport,sendingFrom } from "../sendingView";
import type { CampaignTab,FixTarget,ReadinessItem } from "./readiness";
import { useSendingSetup } from "./sendingSetup";

/** Jump to a panel on the Overview and move focus into it. */
export function focusAnchor(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const disclosure = el.closest("details");
  if (disclosure) disclosure.open = true;
  el.scrollIntoView?.({ block: "start" });
  el.focus({ preventScroll: true });
}

/** Compact summary plus a single prioritized next task. The guarded test and
 * final-send actions stay in their own panel below; prepare approves the
 * current content revision. */
export default function OverviewPane({
  items,
  doc,
  binding,
  audienceLabel,
  onTab,
}: {
  items: ReadinessItem[];
  doc: ContentDoc | null;
  binding: SmtpBinding | null | undefined;
  audienceLabel: string;
  onTab: (tab: CampaignTab) => void;
}) {
  const { t, formatNumber } = useLocale();
  const setup = useSendingSetup();
  const [who, ...countStatuses] = audienceLabel.split(" · ");
  const localizedWho = who === "All customers"
    ? t(who)
    : who.startsWith("Segment ")
      ? `${t("Segment")} ${who.slice("Segment ".length)}`
      : who.endsWith(" chosen customers")
        ? `${formatNumber(Number.parseInt(who, 10))} ${t("chosen customers")}`
        : who;
  const localizedCounts = countStatuses.map((countStatus) => countStatus === "not counted yet"
    ? t(countStatus)
    : countStatus.endsWith(" match")
      ? `${formatNumber(Number.parseInt(countStatus, 10))} ${t("match")}`
      : countStatus.endsWith(" can be emailed")
        ? `${formatNumber(Number.parseInt(countStatus, 10))} ${t("can be emailed")}`
        : countStatus);
  const localizedAudience = [localizedWho, ...localizedCounts].filter(Boolean).join(" · ");
  const next = items.find((item) => !item.done && item.fix !== null);
  // The checklist line is a state label; the next task names the action
  // still needed.
  const nextAction = next === undefined ? null :
    next.key === "draft"
      ? "Draft or review the email"
      : next.key === "freeze"
        ? "Freeze the audience and recheck it"
        : next.key === "sender"
          ? "Connect a sending account"
          : "Send an accepted test email";
  const from = sendingFrom(binding);
  // The next-task CTA only opens the panel that owns the decision; it
  // never approves, tests or sends. Keep that distinction explicit.
  const nextFixLabel = next === undefined || next.fix === null ? "" :
    next.fix.kind === "href"
      ? next.fix.label
      : next.key === "test"
        ? "Go to test send"
        : next.key === "freeze"
          ? "Open audience"
          : "Open email";
  const go = (fix: Exclude<FixTarget, { kind: "href" }>) =>
    fix.kind === "tab" ? onTab(fix.tab) : focusAnchor(fix.id);
  return (
    <>
    <div className="crm-cgrid" data-campaign-overview>
      <section aria-label={t("Next task")} className="card px-4 py-4 grid gap-2" data-next-task>
        <h4 className="text-cardtitle font-medium text-ink-100">{t("Next task")}</h4>
        {next === undefined ? (
          <>
            <p className="text-label text-ink-200">{t("All test and review prerequisites are recorded.")}</p>
            <p className="text-micro text-ink-500">{t("Final send still requires a separate guarded operator review.")}</p>
            <Button size="sm" className="justify-self-start" onClick={() => focusAnchor("cmp-final-send")}>
              {t("Review final send")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-label text-ink-200">{t(nextAction ?? next.label)}</p>
            {next.reason && <p className="text-micro text-ink-500">{t("Requires")}{" "}{t(next.reason)}.</p>}
            {next.fix?.kind === "href" ? (
              next.fix.href === EMAIL_SENDING_HREF && !setup.available ? (
                <p className="text-micro text-ink-500" data-smtp-setup="unavailable">{t("Sending setup isn't available on this host.")}</p>
              ) : next.fix.href === EMAIL_SENDING_HREF ? (
                <Button
                  size="sm"
                  className="justify-self-start"
                  href={EMAIL_SENDING_HREF}
                  loading={setup.pending}
                  disabled={setup.pending}
                  onClick={(event) => { event.preventDefault(); setup.open(); }}
                >{t(nextFixLabel)}</Button>
              ) : (
                <Button size="sm" className="justify-self-start" href={next.fix.href}>{t(nextFixLabel)}</Button>
              )
            ) : next.fix !== null ? (
              <Button size="sm" className="justify-self-start" onClick={() => go(next.fix as Exclude<FixTarget, { kind: "href" }>)}>
                {t(nextFixLabel)}
              </Button>
            ) : null}
          </>
        )}
      </section>
      <section aria-label={t("Campaign summary")} className="card px-4 py-4 grid gap-2">
        <h4 className="text-cardtitle font-medium text-ink-100">{t("Campaign summary")}</h4>
        <dl className="sdetail" data-content-summary>
          <div><dt>{t("Audience")}</dt><dd>{localizedAudience}</dd></div>
          <div>
            <dt>{t("Sender")}</dt>
            <dd>
              {binding === undefined ? t("Checking…")
                : binding === null || from === null
                  ? setup.available
                    ? <Link
                        href={EMAIL_SENDING_HREF}
                        onClick={(event) => { event.preventDefault(); setup.open(); }}
                      >{t("No sender connected · Set up")}</Link>
                    : <span data-smtp-setup="unavailable">{t("No sender connected")}. {t("Sending setup isn't available on this host.")}</span>
                  : `${binding.sender.name} <${from}>${isHostedTransport(binding) ? ` · ${t("via AgenticOS")}` : ""}`}
              {setup.error !== null && (
                <p className="text-label text-fail mt-1" role="alert">{setup.error}</p>
              )}
            </dd>
          </div>
          <div><dt>{t("Email")}</dt><dd>{doc === null ? t("Not drafted") : doc.subject}</dd></div>
          <div>
            <dt>{t("Content")}</dt>
            <dd>{doc === null ? t("No saved revision") : `r${formatNumber(doc.revision)}`}</dd>
          </div>
        </dl>
      </section>
    </div>
    <section aria-label={t("Send checks")} className="card px-4 py-4 grid gap-2" data-send-checks>
      <h4 className="text-cardtitle font-medium text-ink-100">{t("Send checks")}</h4>
      <ul className="crm-ready">
        {items.filter((item) => item.checklist).map((item) => (
          <li key={item.key}>
            <span className="crm-tick" data-done={item.done ? "" : undefined} aria-hidden="true">{item.done ? "✓" : ""}</span>
            <span>{t(item.label)}</span>
            {!item.done && item.fix !== null && (
              item.fix.kind === "href" ? (
                setup.available ? (
                  <button type="button" className="lnk crm-ready-go" onClick={() => setup.open()}>
                    {t(item.fix.label)}
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  className="lnk crm-ready-go"
                  onClick={() => go(item.fix as Exclude<FixTarget, { kind: "href" }>)}
                >
                  {t(item.key === "freeze" ? "Open audience" : item.fix.label)}
                </button>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
    </>
  );
}
