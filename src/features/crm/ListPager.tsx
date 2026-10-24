import { Button, Select } from "@cadence/screen-ui";
import { useLocale } from "./locale";

export const LIST_PAGE_SIZE = 20;

/** Presentation only: callers own cursor discovery or local array paging. */
export default function ListPager({
  page, pageCount, summary, onPage, onNext, hasNext, busy, label, visitedOnly = false,
}: {
  page: number;
  pageCount: number;
  summary: string;
  onPage: (page: number) => void;
  onNext?: () => void;
  hasNext: boolean;
  busy: boolean;
  label: string;
  visitedOnly?: boolean;
}) {
  const { t, formatNumber } = useLocale();
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
            label: t("Page {page}").replace("{page}", formatNumber(index + 1)),
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
