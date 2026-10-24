import { Button, Select } from "@cadence/screen-ui";
import { useLocale } from "./locale";

export const LIST_PAGE_SIZE = 20;

/** Presentation only: callers own cursor discovery or local array paging. */
export default function ListPager({
  page, pageCount, totalPages, summary, onPage, onNext, hasNext, busy, label, visitedOnly = false,
}: {
  page: number;
  pageCount: number;
  /** True count of pages for the current result set, when the host reports one.
   *  The select still lists visited cursor pages; this names the total. */
  totalPages?: number;
  summary: string;
  onPage: (page: number) => void;
  onNext?: () => void;
  hasNext: boolean;
  busy: boolean;
  label: string;
  visitedOnly?: boolean;
}) {
  const { t, formatNumber } = useLocale();
  // The host total can lag a just-trimmed cursor list; never print a page
  // beyond the total or fewer pages than have already been visited.
  const totalCount = Math.max(pageCount, page + 1, totalPages ?? 0);
  const pageLabel = (index: number) => {
    const number = formatNumber(index + 1);
    if (index === page && totalPages !== undefined) {
      return t("Page {page} of {total}").replace("{page}", number).replace("{total}", formatNumber(totalCount));
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
          value={String(page)}
          onChange={(value) => onPage(Number(value))}
          options={Array.from({ length: pageCount }, (_, index) => ({
            value: String(index),
            label: pageLabel(index),
          }))}
          disabled={busy || pageCount <= 1}
          aria-label={label}
          title={t(visitedOnly ? "Choose a visited page" : "Choose a page")}
        />
        <Button disabled={!hasNext || busy} onClick={onNext ?? (() => onPage(page + 1))}>
          {t("Next")} →
        </Button>
      </div>
    </div>
  );
}
