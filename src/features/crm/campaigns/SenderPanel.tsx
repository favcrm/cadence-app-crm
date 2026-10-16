import { useLocale } from "../locale";
import {
type ContentRender
} from "../campaignGrammar";
import "../crm-campaign.css";



export default function SenderPanel({ render }: { render: ContentRender }) {
  const { t } = useLocale();
  return (
    <section aria-label={t("Sender")} className="card px-3 py-3 grid gap-2">
      <h4 className="text-label font-medium text-ink-200">{t("Sender in this render — preview")}</h4>
      <dl className="crm-detail">
        <div>
          <dt>{t("From")}</dt>
          <dd className="num">
            {render.sender.name} · {render.sender.address}
          </dd>
        </div>
        <div>
          <dt>{t("Unsubscribe")}</dt>
          <dd className="num">{render.unsubscribeUrl}</dd>
        </div>
        <div>
          <dt>{t("Binding")}</dt>
          <dd className="num">
            {render.bindingId} · {t("preview-only")}
            {render.previewOnly ? "" : ` (${t("unexpected — reported")})`}
          </dd>
        </div>
      </dl>
      <p className="text-micro text-ink-500">
        {t("The render names the host's preview sender; the real sender is the bound SMTP connection above, and every send's unsubscribe links build on the configured origin. A preview proves the bytes only — sending is the operator's separate decision below.")}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Detail page (New is the dialog in campaign/NewCampaignDialog).      */
/* ------------------------------------------------------------------ */
