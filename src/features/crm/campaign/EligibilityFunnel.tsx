import { useLocale } from "../locale";
import type { AudiencePreview } from "../segments/Segments";

/**
 * One plain-language audience count (CAD-1055) over the host's existing
 * audience preview — no new wire. The headline is the only number that
 * decides anything; the exclusions are one quiet line so the reader can
 * see why the count is not the whole base. Every figure the host
 * reported is shown as reported; nothing is inferred here.
 */
export function blockingReason(
  preview: AudiencePreview,
  translate: (english: string) => string = (english) => english,
): string | null {
  if (preview.finalCount > 0) return null;
  if (preview.baseCount === 0) return translate("No customers match this audience. Pick another segment.");
  const reasons: [number, string][] = [
    [preview.excluded.noConsent, translate("lack email consent. Record consent on those customers or pick another segment.")],
    [preview.excluded.invalid, translate("have no valid email address.")],
    [preview.excluded.unsubscribed, translate("have unsubscribed.")],
    [preview.excluded.suppressed, translate("are suppressed.")],
    [preview.exclusionCount, translate("are on the exclusion list.")],
  ];
  const [count, why] = reasons.reduce((best, row) => (row[0] > best[0] ? row : best));
  if (count <= 0) return translate("Nobody in this audience can be emailed.");
  return count === preview.baseCount
    ? `${translate("All")} ${count} ${why}`
    : `${count} ${translate("of")} ${preview.baseCount} ${why}`;
}

export default function EligibilityFunnel({
  preview,
  loading,
  error,
  onRetry,
}: {
  preview: AudiencePreview | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { t, formatNumber } = useLocale();
  if (loading) {
    return (
      <p className="text-secondary text-ink-400" role="status">
        {t("Reading host audience counts…")}
      </p>
    );
  }
  if (error !== null) {
    return (
      <p className="card px-4 py-3 text-label text-fail border-fail/40" role="alert">
        {error}{" "}
        <button type="button" className="lnk" onClick={onRetry}>
          {t("Retry")}
        </button>
      </p>
    );
  }
  if (preview === null) return null;
  const base = Math.max(preview.baseCount, 1);
  const share = Math.min(100, Math.round((preview.finalCount / base) * 100));
  const excluded: string[] = [];
  if (preview.exclusionCount > 0) excluded.push(`${formatNumber(preview.exclusionCount)} ${t("on the exclusion list")}`);
  if (preview.excluded.invalid > 0) excluded.push(`${formatNumber(preview.excluded.invalid)} ${t("no valid email address")}`);
  if (preview.excluded.noConsent > 0) excluded.push(`${formatNumber(preview.excluded.noConsent)} ${t("no email consent")}`);
  if (preview.excluded.unsubscribed > 0) excluded.push(`${formatNumber(preview.excluded.unsubscribed)} ${t("unsubscribed")}`);
  if (preview.excluded.suppressed > 0) excluded.push(`${formatNumber(preview.excluded.suppressed)} ${t("suppressed")}`);
  const reason = blockingReason(preview, t);
  return (
    <div className="grid gap-2" aria-label={t("Eligibility")} data-funnel data-final-count={preview.finalCount}>
      <p className="text-label text-ink-100" role="status">
        {t("{final} of {base} customers can be emailed")
          .replace("{final}", () => formatNumber(preview.finalCount))
          .replace("{base}", () => formatNumber(preview.baseCount))}
      </p>
      <span className="crm-funnel-bar" aria-hidden="true">
        <i style={{ width: `${share}%` }} />
      </span>
      {excluded.length > 0 && (
        <p className="text-micro text-ink-500" data-excluded-count={preview.baseCount - preview.finalCount}>
          {t("Excluded:")} {excluded.join(" · ")}
        </p>
      )}
      {reason !== null && (
        <p className="text-label text-warn" role="status" data-blocked>
          {reason}
        </p>
      )}
    </div>
  );
}
