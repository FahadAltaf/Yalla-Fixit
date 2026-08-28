import * as XLSX from "xlsx";

/**
 * Saving a table of figures as CSV or Excel (FR-10.06).
 *
 * Both formats are written from the same columns and the same rows, so
 * a spreadsheet a client opens says exactly what the screen said. The
 * caller passes the columns it is displaying rather than the raw
 * objects: exporting every field an API happens to return is how a job
 * id ends up in a file that goes to a developer.
 */

export type ExportColumn = { key: string; label: string };
export type ExportRow = Record<string, string | number | null | undefined>;

export type ExportFormat = "csv" | "xlsx";

/**
 * Rows keyed by column, in display order, with headers written out.
 * Blanks stay blank rather than becoming the string "null".
 */
function toMatrix(columns: ExportColumn[], rows: ExportRow[]): Array<Array<string | number>> {
  return [
    columns.map((column) => column.label),
    ...rows.map((row) =>
      columns.map((column) => {
        const value = row[column.key];
        return value === null || value === undefined ? "" : value;
      }),
    ),
  ];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * A CSV cell is quoted and its own quotes doubled, always.
 *
 * Unit labels and developer names carry commas often enough that
 * quoting only when a comma appears is a bug waiting for the first
 * "Marina Heights, Tower 2".
 */
function toCsv(matrix: Array<Array<string | number>>): string {
  return matrix
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

export function exportTable({
  columns,
  rows,
  filename,
  format,
  sheetName = "Export",
}: {
  columns: ExportColumn[];
  rows: ExportRow[];
  /** Without an extension — this adds the one that matches the format. */
  filename: string;
  format: ExportFormat;
  sheetName?: string;
}) {
  const matrix = toMatrix(columns, rows);

  if (format === "csv") {
    // The BOM is what makes Excel open a UTF-8 CSV without turning
    // every accented name into mojibake.
    const blob = new Blob(["﻿", toCsv(matrix)], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${filename}.csv`);
    return;
  }

  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  // Column widths from the content, so nothing opens as a row of ####.
  sheet["!cols"] = columns.map((column, index) => ({
    wch: Math.min(
      44,
      Math.max(column.label.length + 2, ...matrix.slice(1).map((line) => String(line[index]).length + 2)),
    ),
  }));

  const book = XLSX.utils.book_new();
  // Excel rejects a sheet name over 31 characters or carrying : \ / ? * [ ].
  XLSX.utils.book_append_sheet(book, sheet, sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
  XLSX.writeFile(book, `${filename}.xlsx`);
}

/** Filenames that sort by date and survive every filesystem. */
export function exportFilename(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
