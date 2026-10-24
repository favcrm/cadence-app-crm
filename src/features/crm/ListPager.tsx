import { Button, Select } from "@cadence/screen-ui";
import { useLocale } from "./locale";

export const LIST_PAGE_SIZE = 20;

/** Presentation only: callers own cursor discovery or local array paging. */
export default function ListPager({
  page, pageCount, pendingPage, summary, onPage, onNext, hasNext, busy, label,
}: {
  page: number;
  /** Total pages for the current result set: the host total when known,
   *  otherwise the pages discovered so far. */
  pageCount: number;
  /** A page being fetched by the caller; shown while the controls are busy. */
  pendingPage?: number;
  summary: string;
  onPage: (page: number) => void;
  onNext?: () => void;
  hasNext: boolean;
  busy: boolean;
  label: string;
}) {
  const { t, formatNumber } = useLocale();
  const pages = Math.max(1, pageCount);
  const selected = Math.min(Math.max(pendingPage ?? page, 0), pages - 1);
  const pageLabel = (index: number) => {
    const number = formatNumber(index + 1);
    if (index === selected) {
      return t("Page {page} of {total}").replace("{page}", number).replace("{total}", formatNumber(pages));
    }
    return t("Page {page}").replace("{page}", number);
  };
  return (
    <div className="crm-pager">
      <span className="text-label text-ink-400" aria-live="polite">{summary}</span>
      <div className="crm-page-controls">
        <Button disabled={page === 0 || busy} onClick={() => onPage(page - 1)}>
          ← {t("Previous")}
        </Button>
        <Select
          value={String(selected)}
          onChange={(value) => onPage(Number(value))}
          options={Array.from({ length: pages }, (_, index) => ({
            value: String(index),
            label: pageLabel(index),
          }))}
          disabled={busy || pages <= 1}
          aria-label={label}
          title={t("Choose a page")}
        />
        <Button disabled={!hasNext || busy} onClick={onNext ?? (() => onPage(page + 1))}>
          {t("Next")} →
        </Button>
      </div>
    </div>
  );
}
