import { useLocale } from "../locale";
import { ApiError, Button, DataTable, ErrorNotice, Field, Notice } from "@cadence/screen-ui";
import { useState, type ChangeEvent } from "react";
import FrameDrawer from "../FrameDrawer";
import {
  CRM_CSV_MAX_BYTES,
  hostActions,
  type CsvPreviewReceipt,
  type CsvPreviewRow,
  type HostScope,
} from "../hostActions";
import { hostErrorText, isApprovalRequired } from "../hostErrors";

export interface ImportCsvDrawerProps {
  scope: HostScope;
  onClose: () => void;
  onImported: (created: number) => void;
}

const MAX_BYTES = CRM_CSV_MAX_BYTES;
const encoder = new TextEncoder();

export default function ImportCsvDrawer({ scope, onClose, onImported }: ImportCsvDrawerProps) {
  const { t, formatNumber } = useLocale();
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CsvPreviewReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);

  const busy = previewing || importing;

  const formatPreviewError = (err: unknown, fallback: string): string => {
    if (isApprovalRequired(err)) {
      return t("Waiting for the owner's approval — nothing has changed yet.");
    }
    if (err instanceof ApiError && (err.code === "unsupported_verb" || err.code === "operation_not_declared")) {
      return t("This host does not support CSV import preview yet. Try adding customers one at a time.");
    }
    return hostErrorText(err, fallback);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(t("CSV exceeds the 120 KB limit."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError(t("Could not read the selected file as UTF-8 text."));
        return;
      }
      if (encoder.encode(reader.result).byteLength > MAX_BYTES) {
        setError(t("CSV exceeds the 120 KB limit."));
        return;
      }
      setFileName(file.name);
      setCsvText(reader.result);
    };
    reader.onerror = () => {
      setError(t("Could not read the selected file as UTF-8 text."));
    };
    reader.readAsText(file, "utf-8");
  };

  const runPreview = async () => {
    if (busy) return;
    if (csvText.trim().length === 0) {
      setError(t("CSV content cannot be empty."));
      return;
    }
    if (encoder.encode(csvText).byteLength > MAX_BYTES) {
      setError(t("CSV exceeds the 120 KB limit."));
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const next = await hostActions.previewCsv(scope, csvText);
      setReceipt(next);
    } catch (err: unknown) {
      setError(formatPreviewError(err, t("Could not preview this CSV.")));
    } finally {
      setPreviewing(false);
    }
  };

  const runBatchImport = async () => {
    if (busy || !receipt || receipt.batch_items.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const result = await hostActions.batchCreate(scope, receipt.batch_items);
      onImported(result.created);
    } catch (err: unknown) {
      setError(formatPreviewError(err, t("Could not import the previewed customers.")));
    } finally {
      setImporting(false);
    }
  };

  const resetPreview = () => {
    if (busy) return;
    setReceipt(null);
    setError(null);
  };

  const statusLabel = (row: CsvPreviewRow): string => {
    switch (row.status) {
      case "valid":
        return t("Valid");
      case "duplicate_existing":
        return t("Duplicate (existing)");
      case "duplicate_in_csv":
        return t("Duplicate (in CSV)");
      case "invalid":
        return t("Invalid");
    }
  };

  const statusTone = (row: CsvPreviewRow): "ok" | "warn" | undefined => {
    if (row.status === "valid") return "ok";
    if (row.status === "duplicate_existing" || row.status === "duplicate_in_csv" || row.status === "invalid") {
      return "warn";
    }
    return undefined;
  };

  const rowNote = (row: CsvPreviewRow): string => {
    if (row.status === "duplicate_existing" && row.existing_record_id) {
      return t("Matches {id} (r{rev})")
        .replace("{id}", () => row.existing_record_id ?? "")
        .replace("{rev}", () => String(row.existing_revision ?? 1));
    }
    if (row.status === "duplicate_in_csv" && row.duplicate_of_row !== undefined) {
      return t("Duplicates row {row}").replace("{row}", () => String(row.duplicate_of_row));
    }
    return row.errors.join("; ");
  };

  const panel = !receipt ? (
    <div className="crm-list">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field
        id="crm-csv-file"
        label={t("Choose CSV file")}
        hint={t("UTF-8 CSV file up to 120 KB (max 200 data rows).")}
        disabled={busy}
      >
        {(control) => (
          <div>
            <input
              {...control}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={handleFileChange}
            />
            {fileName && <p className="text-label text-ink-300">{fileName}</p>}
          </div>
        )}
      </Field>
      <Field
        id="crm-csv-text"
        label={t("Or paste CSV text")}
        hint={t("Paste comma-separated rows starting with a header line (e.g. display_name,email,phone,tags).")}
        disabled={busy}
      >
        {(control) => (
          <textarea
            {...control}
            className="field"
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="display_name,email,phone,tags"
          />
        )}
      </Field>
      <Notice>{t("Consent defaults to unknown until recorded separately.")}</Notice>
    </div>
  ) : (
    <div className="crm-list">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <section className="crm-sect" aria-label={t("Summary")}>
        <h4>{t("Summary")}</h4>
        <div className="crm-chips">
          <span className="chip">{t("Total rows")}: {formatNumber(receipt.summary.total_rows)}</span>
          <span className="chip" data-tone="ok">{t("Ready to import")}: {formatNumber(receipt.summary.valid_new)}</span>
          <span className="chip" data-tone={receipt.summary.duplicate_existing > 0 ? "warn" : undefined}>
            {t("Existing duplicates")}: {formatNumber(receipt.summary.duplicate_existing)}
          </span>
          <span className="chip" data-tone={receipt.summary.duplicate_in_csv > 0 ? "warn" : undefined}>
            {t("Duplicates in CSV")}: {formatNumber(receipt.summary.duplicate_in_csv)}
          </span>
          <span className="chip" data-tone={receipt.summary.invalid > 0 ? "warn" : undefined}>
            {t("Invalid rows")}: {formatNumber(receipt.summary.invalid)}
          </span>
        </div>
      </section>
      {receipt.mapped_headers.length > 0 && (
        <p className="text-label text-ink-300">
          {t("Recognized headers")}: {receipt.mapped_headers.join(", ")}
        </p>
      )}
      {receipt.unmapped_headers.length > 0 && (
        <p className="text-label text-ink-400">
          {t("Ignored headers")}: {receipt.unmapped_headers.join(", ")}
        </p>
      )}
      {receipt.warnings.map((warning, idx) => (
        <Notice key={idx}>{warning}</Notice>
      ))}
      <Notice>{t("Consent defaults to unknown until recorded separately.")}</Notice>
      {receipt.rows.length > 0 && (
        <section className="crm-sect" aria-label={t("Preview rows")}>
          <h4>{t("Preview rows")}</h4>
          <DataTable<CsvPreviewRow>
            label={t("Preview rows")}
            wrapClassName="crm-table-wrap"
            tableClassName="crm-table"
            rowKey={(row) => row.row_number}
            rows={receipt.rows}
            columns={[
              { key: "row", header: t("Row"), cell: (row) => formatNumber(row.row_number) },
              { key: "name", header: t("Name"), cell: (row) => row.display_name ?? "—" },
              { key: "email", header: t("Email"), cell: (row) => row.email ?? "—" },
              {
                key: "status",
                header: t("Status"),
                cell: (row) => (
                  <span className="chip" data-tone={statusTone(row)}>
                    {statusLabel(row)}
                  </span>
                ),
              },
              { key: "notes", header: t("Notes"), cell: (row) => rowNote(row) || "—" },
            ]}
          />
        </section>
      )}
    </div>
  );

  const importLabel = receipt
    ? receipt.batch_items.length === 1
      ? t("Import 1 customer")
      : t("Import {count} customers").replace("{count}", () => String(receipt.batch_items.length))
    : t("Preview CSV");

  return (
    <FrameDrawer
      kind="customer"
      label={t("Import CSV")}
      title={t("Import customers from CSV")}
      subtitle={t("Preview rows and duplicate emails before creating records. Up to 200 rows (120 KB).")}
      tabs={[{ id: "import", label: t("CSV import"), panel }]}
      onClose={onClose}
      secondary={
        <Button onClick={receipt ? resetPreview : onClose} disabled={busy}>
          {t(receipt ? "Back to CSV" : "Close")}
        </Button>
      }
      primary={
        !receipt ? (
          <Button variant="primary" onClick={() => void runPreview()} disabled={busy || csvText.trim().length === 0}>
            {t(previewing ? "Previewing…" : "Preview CSV")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void runBatchImport()} disabled={busy || receipt.batch_items.length === 0}>
            {importing ? t("Importing…") : importLabel}
          </Button>
        )
      }
    />
  );
}
