import { inlineParts, parseScope, parseTerms } from "@/lib/snagging/quote-text";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type IBorderOptions,
} from "docx";

import yallaFixit from "@/public/yalla-fixit.png";
import { formatCurrencyAED } from "@/utils/format-currency";

import { loadPhoto, type Photo } from "../amc/amc-docx";
import { lineDiscount, quotationDisplayNumber, quotationFigures } from "./quotation-figures";
import type { QuotationData } from "./quotation-templates";

/**
 * The quotation as an editable Word file, in the same design as the PDF
 * (templates/YallaClassicTemplate.tsx): logo and company top-left,
 * "Quotation" with its number and date top-right, Customer and Service
 * Address side by side, the black-headed striped line table, the totals on
 * the right with the black Grand Total bar, then scope of work, terms and
 * bank details. The same discount modes and revision numbering apply.
 */

/* A4 with the template's narrow side margins, in twentieths of a point. */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN_X = 600;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK = "1A1A2E";
const DARK = "1E293B";
const MUTED = "64748B";
const SLATE = "334155";
const ROW_ALT = "F8FAFC";
const RULE = "E2E8F0";

const none: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: none, bottom: none, left: none, right: none };
const rowRule = { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } };

/* Word sizes are half-points; the template's are pixels (px × 1.5 = half-points). */
const size = (px: number) => Math.round(px * 1.5);

type RunOpts = { bold?: boolean; color?: string; px?: number };
const run = (text: string, { bold, color, px = 11 }: RunOpts = {}) =>
  new TextRun({ text, bold, color: color ?? INK, size: size(px) });

const p = (children: (TextRun | ImageRun)[], opts: { align?: "left" | "right" | "center"; after?: number; before?: number } = {}) =>
  new Paragraph({
    alignment: opts.align === "right" ? AlignmentType.RIGHT : opts.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 40, line: 276 },
    children,
  });

const cell = (children: Paragraph[], width: number, opts: { fill?: string; borders?: typeof noBorders; margin?: number } = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: opts.borders ?? noBorders,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    margins: { top: opts.margin ?? 120, bottom: opts.margin ?? 120, left: 180, right: 180 },
    children,
  });

const sectionTitle = (text: string) =>
  p([run(text.toUpperCase(), { bold: true, px: 11 })], { before: 360, after: 160 });

/* Word needs a paragraph between two tables, or it joins them. */
const gap = (after = 120) => new Paragraph({ spacing: { after }, children: [] });

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function generateQuotationWordBlob(
  data: QuotationData,
  options: {
    hideDiscount?: boolean;
    discountMode?: string;
    includeServiceItemImages?: boolean;
    rootQuotationNumber?: string;
  } = {},
): Promise<Blob> {
  const { hideDiscount = false, discountMode, includeServiceItemImages = false, rootQuotationNumber } = options;
  const figures = quotationFigures(data);
  const isByTotal = discountMode === "with-total" || discountMode === "with-total-no-list";
  const showDiscountColumn = !hideDiscount && !isByTotal;
  const priceLabel = discountMode === "with-total-no-list" ? "Unit Price" : "List Price";
  const discountPct = figures.subTotal > 0 ? (figures.discount / figures.subTotal) * 100 : 0;

  /* Photos, when asked for; one that fails to load is left out. */
  const imageUrls = includeServiceItemImages ? (data.serviceItemImages ?? []) : [];
  const [logo, ...photoList] = await Promise.all([
    fetchBytes(yallaFixit.src),
    ...imageUrls.map((image) => loadPhoto(image.supabaseUrl)),
  ]);
  const photosByItem = new Map<string, Photo[]>();
  imageUrls.forEach((image, index) => {
    const photo = photoList[index];
    if (!photo) return;
    photosByItem.set(image.serviceItemId, [...(photosByItem.get(image.serviceItemId) ?? []), photo]);
  });

  /* ── Header: logo + company, and Quotation / number / date ── */
  const half = Math.round(CONTENT_W / 2);
  const header = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [half, CONTENT_W - half],
    rows: [
      new TableRow({
        children: [
          cell(
            [
              new Paragraph({
                spacing: { after: 0 },
                children: [
                  new ImageRun({ type: "png", data: logo, transformation: { width: 70, height: 72 } }),
                ],
              }),
              p([run(data.companyName, { bold: true, px: 18 })], { before: 80, after: 20 }),
              p([run(data.companyAddress || "Office 102, Building 6, Gold & Diamond Park, Dubai", { px: 11 })], { after: 0 }),
              p([run(data.companyWebsite || "https://www.yallafixit.ae", { px: 11 })]),
            ],
            half,
            { margin: 0 },
          ),
          cell(
            [
              p([run("Quotation", { bold: true, px: 14 })], { align: "right", after: 60 }),
              p([run(quotationDisplayNumber(data, rootQuotationNumber), { bold: true, px: 14, color: DARK })], {
                align: "right",
                after: 20,
              }),
              p([run(data.quotationDate, { px: 11, color: MUTED })], { align: "right" }),
            ],
            CONTENT_W - half,
            { margin: 0 },
          ),
        ],
      }),
    ],
  });

  /* ── Customer and service address ── */
  const parties = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [half, CONTENT_W - half],
    rows: [
      new TableRow({
        children: [
          cell(
            [
              p([run("Customer", { bold: true, px: 14 })], { after: 60 }),
              p([run(data.customerCompanyName, { bold: true })], { after: 20 }),
              ...[data.customerContact, data.customerPhone, data.customerEmail]
                .filter((value): value is string => Boolean(value))
                .map((value) => p([run(value)], { after: 20 })),
            ],
            half,
            { margin: 0 },
          ),
          cell(
            data.serviceAddress
              ? [
                  p([run("Service Address", { bold: true, px: 14 })], { after: 60 }),
                  p([run(data.serviceAddress, { color: "475569" })]),
                ]
              : [p([])],
            CONTENT_W - half,
            { margin: 0 },
          ),
        ],
      }),
    ],
  });

  /* ── Line items: black header, striped rows ── */
  const headings = [
    "SR #",
    "Service & Part",
    "Qty",
    "Unit",
    priceLabel,
    ...(showDiscountColumn ? ["Discount"] : []),
    "Amount",
  ];
  const pct = showDiscountColumn ? [6, 42, 7, 9, 12, 11, 13] : [6, 48, 8, 9, 14, 15];
  const widths = pct.map((w) => Math.round((CONTENT_W * w) / 100));
  const rightAligned = (index: number) => index >= 2;

  const headerRow = new TableRow({
    tableHeader: true,
    children: headings.map((heading, index) =>
      cell(
        [p([run(heading, { bold: true, color: "FFFFFF", px: 11 })], { align: rightAligned(index) ? "right" : "left", after: 0 })],
        widths[index],
        { fill: "000000" },
      ),
    ),
  });

  const itemRows = data.lineItems.map((item, index) => {
    const amount = item.quantity * item.unitPrice - lineDiscount(item);
    const fill = index % 2 === 0 ? ROW_ALT : "FFFFFF";
    const photos = item.serviceItemId ? photosByItem.get(item.serviceItemId) ?? [] : [];
    /* Two photos to a row, as in the PDF. Twips ÷ 15 = pixels. */
    const photoWidth = Math.max(60, Math.floor((widths[1] - 360) / 15 / 2) - 6);
    const photoRows: Paragraph[] = [];
    for (let i = 0; i < photos.length; i += 2) {
      photoRows.push(
        new Paragraph({
          spacing: { before: 120, after: 0 },
          children: photos.slice(i, i + 2).flatMap((photo, n) => [
            ...(n > 0 ? [new TextRun({ text: "  " })] : []),
            new ImageRun({
              type: "jpg",
              data: photo.data,
              transformation: { width: photoWidth, height: Math.round((photoWidth * photo.height) / photo.width) },
            }),
          ]),
        }),
      );
    }

    const values = [
      String(index + 1),
      null, // description, built below
      String(item.quantity),
      item.unit,
      formatCurrencyAED(item.unitPrice),
      ...(showDiscountColumn
        ? [
            item.discountType === "Currency"
              ? formatCurrencyAED(item.discountAmount)
              : `${(item.discountAmount ?? 0).toFixed(0)}%`,
          ]
        : []),
      formatCurrencyAED(amount),
    ];

    return new TableRow({
      cantSplit: true,
      children: values.map((value, column) => {
        if (column === 1) {
          return cell(
            [
              p([run(item.description, { bold: true, color: DARK })], { after: 60 }),
              ...(item.details
                ? item.details.split(/\r?\n/).map((line) => p([run(line, { color: MUTED })], { after: 0 }))
                : []),
              ...photoRows,
            ],
            widths[column],
            { fill, borders: rowRule },
          );
        }
        const isAmount = column === values.length - 1;
        return cell(
          [
            p([run(value ?? "", { bold: isAmount, color: column === 0 || column === 3 ? MUTED : isAmount ? "000000" : INK })], {
              align: rightAligned(column) ? "right" : "left",
              after: 0,
            }),
          ],
          widths[column],
          { fill, borders: rowRule },
        );
      }),
    });
  });

  const items = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...itemRows],
  });

  /* ── Totals: right-hand column, black Grand Total bar ── */
  const discountLabel =
    discountMode === "with-total-no-list"
      ? `Discount (${discountPct.toFixed(0)}%)`
      : discountMode === "with-total" && data.totalDiscountType === "Percentage"
        ? `Discount (${data.totalDiscount}%)`
        : "Discount";
  const totalLines: [string, number, boolean][] = [
    ["Sub Total", figures.subTotal, false],
    ...(hideDiscount
      ? []
      : ([
          [discountLabel, figures.discount, true],
          ["Total After Discount", figures.totalAfterDiscount, true],
        ] as [string, number, boolean][])),
    [data.taxAmount != null ? "Tax Amount (5%)" : `Tax Amount (${figures.avgTax.toFixed(0)}%)`, figures.taxAmount, true],
  ];
  const totalsWidth = 4400;
  const labelWidth = 2600;
  const totalRow = (label: string, value: string, opts: { muted?: boolean; grand?: boolean }) =>
    new TableRow({
      cantSplit: true,
      children: [label, value].map((text, index) =>
        cell(
          [
            p([run(text, { bold: opts.grand, px: opts.grand ? 13 : 11, color: opts.grand ? "FFFFFF" : opts.muted ? MUTED : DARK })], {
              align: index === 1 ? "right" : "left",
              after: 0,
            }),
          ],
          index === 0 ? labelWidth : totalsWidth - labelWidth,
          opts.grand ? { fill: "000000", margin: 140 } : { borders: rowRule, margin: 90 },
        ),
      ),
    });
  const totals = new Table({
    width: { size: totalsWidth, type: WidthType.DXA },
    alignment: AlignmentType.RIGHT,
    columnWidths: [labelWidth, totalsWidth - labelWidth],
    rows: [
      ...totalLines.map(([label, value, muted]) => totalRow(label, formatCurrencyAED(value), { muted })),
      totalRow("Grand Total", formatCurrencyAED(figures.grandTotal), { grand: true }),
    ],
  });

  /* ── Scope of work ──
     Point 14: the same reading as the PDF -- headings, sub-headings, real
     bullets and **bold** (lib/snagging/quote-text). */
  const inline = (text: string, base: RunOpts = {}) =>
    inlineParts(text).map((part) => run(part.text, { ...base, bold: base.bold || part.bold }));
  const scope = parseScope(data.scopeOfWork).map((line, index) => {
    const bullet = line.kind === "bullet";
    const heading = line.kind === "heading";
    const strong = heading || line.kind === "subheading";
    return new Paragraph({
      indent: bullet ? { left: 360, hanging: 200 } : undefined,
      spacing: {
        before: index === 0 ? 0 : heading ? 200 : strong ? 120 : 0,
        after: heading ? 80 : 50,
        line: 276,
      },
      children: [
        ...(bullet ? [run("•  ", { bold: true, color: SLATE })] : []),
        ...inline(line.text, {
          bold: strong,
          color: bullet ? SLATE : DARK,
          ...(heading ? { px: 13 } : {}),
        }),
      ],
    });
  });

  /* ── Terms: numbered for you, the number in its own column ── */
  const terms = parseTerms(data.termsAndConditions).map(
    (term) =>
      new Paragraph({
        indent: { left: 360, hanging: 360 },
        tabStops: [{ type: TabStopType.LEFT, position: 360 }],
        spacing: { after: 70, line: 276 },
        children: [run(`${term.number}.	`, { bold: true }), ...inline(term.text)],
      }),
  );

  /* ── Bank details ── */
  const bank: [string, string][] = [
    ["ACCOUNT NAME", "YALLA FIX IT ONE PERSON COMPANY LLC"],
    ["BANK NAME", "ABU DHABI COMMERCIAL BANK"],
    ["CID NUMBER", "11214542"],
    ["ACCOUNT NUMBER", "11214542920001"],
    ["IBAN NUMBER", "AE360030011214542920001"],
    ["BRANCH", "SHEIKH ZAYED ROAD"],
    ["SWIFT CODE", "ADCBAEAA"],
  ];

  const doc = new Document({
    creator: data.companyName || "Yalla Fix It",
    title: `Quotation ${quotationDisplayNumber(data, rootQuotationNumber)}`,
    styles: { default: { document: { run: { font: "Arial", size: size(11), color: INK } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: 720, bottom: 720, left: MARGIN_X, right: MARGIN_X },
          },
        },
        children: [
          header,
          gap(360),
          parties,
          gap(280),
          items,
          gap(120),
          totals,
          ...(scope.length ? [sectionTitle("Scope of Work"), ...scope] : []),
          ...(terms.length ? [sectionTitle("Terms and Conditions"), ...terms] : []),
          sectionTitle("Bank Details & Support"),
          p([run("For any questions contact "), run("800-PERFECT", { bold: true, color: DARK })], { after: 120 }),
          ...bank.map(([label, value]) => p([run(`${label}: `, { bold: true, color: DARK }), run(value)], { after: 30 })),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
