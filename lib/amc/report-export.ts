import type { ExportColumn, ExportRow } from "@/lib/snagging/export-table";

/**
 * A report saved as a workbook or a CSV laid out like a report (25 Nov
 * 2026): a title, the period, then titled blocks, each a small table with
 * its own headings. In Excel each sheet holds its blocks (the summary on
 * one, each list on its own); in a CSV the blocks follow one another with a
 * blank line between. Money is written as numbers with two decimals, so the
 * figures add up in the spreadsheet.
 */

export interface ReportBlock {
  /** The Excel sheet it goes on (blocks with the same sheet stack on it). */
  sheet: string;
  title: string;
  columns: ExportColumn[];
  rows: ExportRow[];
  /** Columns holding AED amounts. */
  money?: string[];
  /** Columns holding a percentage (written as 87.5, shown as 87.5%). */
  percent?: string[];
  /** A per-cell number format, for a column that mixes units (the summary's Value). */
  formatOf?: (row: ExportRow, key: string) => "money" | "percent" | null;
}

type Cell = string | number;
type Matrix = Cell[][];

const blank = (v: unknown): Cell => (v === null || v === undefined ? "" : (v as Cell));

function blockMatrix(b: ReportBlock): { matrix: Matrix; formats: Array<{ r: number; c: number; z: string }> } {
  const matrix: Matrix = [[b.title], b.columns.map((c) => c.label)];
  const formats: Array<{ r: number; c: number; z: string }> = [];
  if (!b.rows.length) matrix.push(["Nothing in this period."]);
  b.rows.forEach((row) => {
    const r = matrix.length;
    matrix.push(
      b.columns.map((col, c) => {
        const v = blank(row[col.key]);
        const kind = b.formatOf?.(row, col.key) ?? (b.money?.includes(col.key) ? "money" : b.percent?.includes(col.key) ? "percent" : null);
        if (typeof v === "number" && kind) formats.push({ r, c, z: kind === "money" ? "#,##0.00" : '0.0"%"' });
        return v;
      }),
    );
  });
  return { matrix, formats };
}

function csvCell(v: Cell): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** The report as CSV: title, lines, then each block under its title. */
export function reportCsv(title: string, lines: string[], blocks: ReportBlock[]): string {
  const out: Matrix = [[title], ...lines.map((l) => [l]), []];
  let sheet = "";
  for (const b of blocks) {
    /* A list that has its own sheet in Excel starts with that sheet's name as a heading. */
    if (b.sheet !== sheet && b.sheet !== b.title) out.push([b.sheet.toUpperCase()]);
    sheet = b.sheet;
    const { matrix } = blockMatrix(b);
    out.push(...matrix.map((line) => line.map((v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v))), []);
  }
  return out.map((line) => line.map(csvCell).join(",")).join("\r\n");
}

/** Downloads the report as a workbook (a sheet per group of blocks) or a CSV. */
export async function exportReport({
  title,
  lines,
  blocks,
  filename,
  format,
}: {
  title: string;
  lines: string[];
  blocks: ReportBlock[];
  filename: string;
  format: "csv" | "xlsx";
}) {
  if (format === "csv") {
    download(new Blob(["﻿", reportCsv(title, lines, blocks)], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
    return;
  }
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const sheets = [...new Set(blocks.map((b) => b.sheet))];
  for (const name of sheets) {
    const own = blocks.filter((b) => b.sheet === name);
    /* The first sheet carries the report's title and period; the others their own name. */
    const head: Matrix = name === sheets[0] ? [[title], ...lines.map((l) => [l]), []] : [[`${title}: ${name}`], ...lines.slice(0, 1).map((l) => [l]), []];
    const matrix: Matrix = [...head];
    const formats: Array<{ r: number; c: number; z: string }> = [];
    for (const b of own) {
      const at = matrix.length;
      const built = blockMatrix(b);
      matrix.push(...built.matrix, []);
      formats.push(...built.formats.map((f) => ({ ...f, r: f.r + at })));
    }
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    for (const f of formats) {
      const ref = XLSX.utils.encode_cell({ r: f.r, c: f.c });
      if (sheet[ref]) sheet[ref].z = f.z;
    }
    /* Widths from the tables' content, not the long title lines above them. */
    const widest = Math.max(...own.map((b) => b.columns.length));
    sheet["!cols"] = Array.from({ length: widest }, (_, c) => ({
      wch: Math.min(
        48,
        Math.max(
          10,
          ...matrix
            .slice(head.length)
            .filter((line) => line.length > 1)
            .map((line) => String(line[c] ?? "").length + 2),
        ),
      ),
    }));
    XLSX.utils.book_append_sheet(book, sheet, name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
  }
  XLSX.writeFile(book, `${filename}.xlsx`);
}
