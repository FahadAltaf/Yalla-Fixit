import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalPositionRelativeFrom,
  WidthType,
  type IBorderOptions,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";

import {
  AMC_FOOTER,
  buildAmcDocumentModel,
  type AmcDocumentModel,
  type Block,
  type Cell,
  type Run,
  type Tone,
} from "./amc-document-model";
import type { AmcComputedData } from "./amc-types";
import {
  AMC_BRAND_IMAGES,
  AMC_DOC_COLORS,
  AMC_DOC_PT,
} from "./templates/amc-doc/amc-doc-theme";

/**
 * The AMC proposal or contract as an editable Word file.
 *
 * Built from the same document model as the PDF (amc-document-model.ts), so
 * the two always say the same thing; this file only decides how Word draws
 * it — the cover, the logo-and-ISO header, the address footer with page
 * numbers, and the red-and-grey tables of the Word design.
 */

/* A4, in twentieths of a point. */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN_X = 1080;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const hex = (color: string) => color.replace("#", "").toUpperCase();
const half = (points: number) => Math.round(points * 2);

const toneHex: Record<Tone, string> = {
  default: hex(AMC_DOC_COLORS.text),
  muted: hex(AMC_DOC_COLORS.muted),
  brand: hex(AMC_DOC_COLORS.brand),
  white: hex(AMC_DOC_COLORS.white),
};

const fills: Record<NonNullable<Cell["shade"]>, string> = {
  brand: hex(AMC_DOC_COLORS.brand),
  label: hex(AMC_DOC_COLORS.labelFill),
  zebra: hex(AMC_DOC_COLORS.zebraFill),
};

const border: IBorderOptions = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: hex(AMC_DOC_COLORS.border),
};
const noBorder: IBorderOptions = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF",
};
const cellBorders = {
  top: border,
  bottom: border,
  left: border,
  right: border,
};
const noBorders = {
  top: noBorder,
  bottom: noBorder,
  left: noBorder,
  right: noBorder,
};

const alignments = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

function runs(items: Run[], size: number = AMC_DOC_PT.body): TextRun[] {
  return items.map(
    (run) =>
      new TextRun({
        text: run.text,
        bold: run.bold,
        color: run.tone ? toneHex[run.tone] : undefined,
        size: half(size),
      }),
  );
}

function para(
  children: ParagraphChild[],
  options: Omit<IParagraphOptions, "children"> = {},
) {
  return new Paragraph({
    spacing: { after: 80, line: 300 },
    ...options,
    children,
  });
}

/* A photo ready for Word: JPEG bytes and its size in pixels. */
export type Photo = { data: Uint8Array; width: number; height: number };
type Photos = Map<string, Photo>;

function cellPhotos(
  images: string[] | undefined,
  columnTwips: number,
  photos: Photos,
): Paragraph[] {
  const loaded = (images ?? [])
    .map((src) => photos.get(src))
    .filter((p): p is Photo => Boolean(p));
  if (!loaded.length) return [];
  /* Two to a row, as on screen. Twips to pixels at 96 dpi is ÷ 15. */
  const maxWidth = Math.max(60, Math.floor((columnTwips - 220) / 15 / 2) - 6);
  const rows: Photo[][] = [];
  for (let i = 0; i < loaded.length; i += 2) rows.push(loaded.slice(i, i + 2));
  return rows.map(
    (pair) =>
      new Paragraph({
        spacing: { before: 100, after: 0 },
        children: pair.flatMap((photo, index) => [
          ...(index > 0 ? [new TextRun({ text: "  " })] : []),
          new ImageRun({
            type: "jpg",
            data: photo.data,
            transformation: {
              width: maxWidth,
              height: Math.round((maxWidth * photo.height) / photo.width),
            },
          }),
        ]),
      }),
  );
}

function table(
  widths: number[],
  header: Cell[] | undefined,
  rows: Cell[][],
  photos: Photos,
  /* Percent of the page width, set to the right — a totals box. */
  widthPct?: number,
): Table {
  const tableWidth = Math.round((CONTENT_W * (widthPct ?? 100)) / 100);
  const columnWidths = widths.map((w) => Math.round((tableWidth * w) / 100));
  const toRow = (cells: Cell[], isHeader = false) =>
    new TableRow({
      tableHeader: isHeader,
      cantSplit: true,
      children: cells.map(
        (cell, index) =>
          new TableCell({
            width: { size: columnWidths[index], type: WidthType.DXA },
            borders: cellBorders,
            margins: { top: 70, bottom: 70, left: 110, right: 110 },
            shading: cell.shade
              ? {
                  type: ShadingType.CLEAR,
                  color: "auto",
                  fill: fills[cell.shade],
                }
              : undefined,
            children: [
              ...cell.lines.map(
                (line) =>
                  new Paragraph({
                    alignment: alignments[cell.align ?? "left"],
                    spacing: { after: 0, line: 276 },
                    children: runs(
                      line,
                      isHeader ? AMC_DOC_PT.tableHeader : AMC_DOC_PT.table,
                    ),
                  }),
              ),
              ...cellPhotos(cell.images, columnWidths[index], photos),
            ],
          }),
      ),
    });

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    alignment: widthPct ? AlignmentType.RIGHT : undefined,
    columnWidths,
    rows: [
      ...(header ? [toRow(header, true)] : []),
      ...rows.map((row) => toRow(row)),
    ],
  });
}

/* Word needs a paragraph between two tables or they merge into one. */
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

function renderBlock(block: Block, photos: Photos): (Paragraph | Table)[] {
  switch (block.kind) {
    case "contactStrip":
      return [
        para([
          new TextRun({
            text: "Toll Free 800-PERFECT (7373328)",
            color: toneHex.muted,
            size: half(AMC_DOC_PT.small),
          }),
          new TextRun({
            text: "     |     ",
            color: toneHex.brand,
            size: half(AMC_DOC_PT.small),
          }),
          new TextRun({
            text: "ISO 9001 / 14001 / 45001 Certified",
            color: toneHex.muted,
            size: half(AMC_DOC_PT.small),
          }),
        ]),
      ];

    case "banner":
      return [
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [CONTENT_W],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: CONTENT_W, type: WidthType.DXA },
                  borders: noBorders,
                  shading: {
                    type: ShadingType.CLEAR,
                    color: "auto",
                    fill: fills.brand,
                  },
                  margins: { top: 110, bottom: 110, left: 160, right: 160 },
                  children: [
                    new Paragraph({
                      spacing: { after: 0 },
                      children: runs(
                        [{ text: block.text, bold: true, tone: "white" }],
                        AMC_DOC_PT.banner,
                      ),
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        gap(),
      ];

    case "meta":
      return [
        para(
          block.items.flatMap((item, index) => [
            new TextRun({
              text: `${item.label}  `,
              bold: true,
              size: half(AMC_DOC_PT.body),
            }),
            new TextRun({
              text:
                item.value +
                (index < block.items.length - 1 ? "          " : ""),
              size: half(AMC_DOC_PT.body),
            }),
          ]),
          { spacing: { after: 160 } },
        ),
      ];

    case "label":
      return [
        para(runs([{ text: block.text, bold: true, tone: "muted" }]), {
          spacing: { before: 200, after: 100 },
          keepNext: true,
        }),
      ];

    case "table":
      return [
        table(block.widths, block.header, block.rows, photos, block.width),
        gap(),
      ];

    case "heading":
      return [
        para(
          [
            new TextRun({
              text: `${block.number}  `,
              bold: true,
              color: toneHex.brand,
              size: half(AMC_DOC_PT.heading),
            }),
            new TextRun({
              text: block.text,
              bold: true,
              size: half(AMC_DOC_PT.heading),
            }),
          ],
          { spacing: { before: 320, after: 120 }, keepNext: true },
        ),
      ];

    case "subheading":
      return [
        para(
          runs(
            [
              {
                text: `${block.number ? `${block.number}  ` : ""}${block.text}`,
                bold: true,
              },
            ],
            AMC_DOC_PT.subheading,
          ),
          { spacing: { before: 180, after: 80 }, keepNext: true },
        ),
      ];

    case "paragraph":
      return [para(runs(block.runs))];

    case "bullets":
      return block.items.map((item) =>
        para(runs(item), {
          numbering: { reference: "amc-bullets", level: 0 },
          spacing: { after: 60, line: 300 },
        }),
      );

    case "lettered":
      return block.items.map((item) =>
        para(
          [
            new TextRun({
              text: `${item.letter}\t`,
              bold: true,
              size: half(AMC_DOC_PT.body),
            }),
            ...runs(item.runs),
          ],
          {
            indent: { left: 440, hanging: 440 },
            tabStops: [{ type: TabStopType.LEFT, position: 440 }],
          },
        ),
      );

    case "term":
      return [
        para(
          [
            new TextRun({
              text: `${block.number}\t`,
              bold: true,
              color: toneHex.brand,
              size: half(AMC_DOC_PT.body),
            }),
            ...runs(block.runs),
          ],
          {
            indent: { left: 620, hanging: 620 },
            tabStops: [{ type: TabStopType.LEFT, position: 620 }],
          },
        ),
      ];

    case "signatures": {
      const side = (party: string) =>
        new TableCell({
          width: { size: Math.round(CONTENT_W * 0.46), type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              spacing: { after: 700 },
              children: runs(
                [{ text: party, tone: "muted" }],
                AMC_DOC_PT.small,
              ),
            }),
            new Paragraph({
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: toneHex.muted,
                  space: 1,
                },
              },
              spacing: { after: 60 },
              children: [],
            }),
            new Paragraph({
              children: runs(
                [{ text: "Name / Signature / Stamp", tone: "muted" }],
                8,
              ),
            }),
          ],
        });
      const spacer = new TableCell({
        width: {
          size: CONTENT_W - Math.round(CONTENT_W * 0.46) * 2,
          type: WidthType.DXA,
        },
        borders: noBorders,
        children: [new Paragraph({ children: [] })],
      });
      return [
        gap(),
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [
            Math.round(CONTENT_W * 0.46),
            CONTENT_W - Math.round(CONTENT_W * 0.46) * 2,
            Math.round(CONTENT_W * 0.46),
          ],
          rows: [
            new TableRow({
              cantSplit: true,
              children: [side(block.left), spacer, side(block.right)],
            }),
          ],
        }),
      ];
    }
  }
}

async function image(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/* Pixels at 96 dpi, which is what ImageRun's transformation takes. */
const px = (inches: number) => Math.round(inches * 96);

/*
  Photos inside table cells (quotation line items). Each is scaled down to
  at most 1200px wide and re-encoded as JPEG: site photos straight off a
  phone would make the Word file enormous, and Word cannot show WebP. A
  photo that fails to load is left out rather than failing the document.
*/
export async function loadPhoto(url: string): Promise<Photo | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, 1200 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!jpeg) return null;
    return {
      data: new Uint8Array(await jpeg.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
}

async function loadPhotos(model: AmcDocumentModel): Promise<Photos> {
  const urls = new Set<string>();
  for (const block of model.blocks) {
    if (block.kind !== "table") continue;
    for (const row of block.rows)
      for (const c of row) for (const src of c.images ?? []) urls.add(src);
  }
  const entries = await Promise.all(
    [...urls].map(async (url) => [url, await loadPhoto(url)] as const),
  );
  return new Map(
    entries.filter((entry): entry is [string, Photo] => entry[1] !== null),
  );
}

export async function generateAmcDocxBlob(
  data: AmcComputedData,
): Promise<Blob> {
  return generateBrandedDocxBlob(buildAmcDocumentModel(data), {
    cover: true,
    title: `${data.documentType === "contract" ? "AMC Contract" : "AMC Proposal"} ${data.formData.proposalNumber}`,
  });
}

/**
 * Any branded document model as a Word file: optional cover, then pages
 * with the logo-and-ISO header and the address footer. Used by the AMC
 * proposal and contract, and by quotations.
 */
export async function generateBrandedDocxBlob(
  model: AmcDocumentModel,
  options: { cover?: boolean; title?: string } = {},
): Promise<Blob> {
  const { cover: withCover = false, title } = options;
  const [logo, iso, cover, photos] = await Promise.all([
    image(AMC_BRAND_IMAGES.logo),
    Promise.all(AMC_BRAND_IMAGES.iso.map((badge) => image(badge.src))),
    withCover ? image(AMC_BRAND_IMAGES.cover) : Promise.resolve(null),
    loadPhotos(model),
  ]);

  const header = new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 4,
            color: hex(AMC_DOC_COLORS.rule),
            space: 6,
          },
        },
        children: [
          new ImageRun({
            type: "png",
            data: logo,
            transformation: { width: px(1.72), height: px(0.95) },
          }),
          new TextRun({ text: "\t" }),
          ...iso.flatMap((badge, index) => [
            ...(index > 0 ? [new TextRun({ text: "   " })] : []),
            new ImageRun({
              type: "png",
              data: badge,
              transformation: { width: px(0.51), height: px(0.57) },
            }),
          ]),
        ],
      }),
    ],
  });

  const sep = () =>
    new TextRun({
      text: "  |  ",
      color: toneHex.brand,
      size: half(AMC_DOC_PT.footer),
    });
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: {
          top: {
            style: BorderStyle.SINGLE,
            size: 4,
            color: hex(AMC_DOC_COLORS.rule),
            space: 4,
          },
        },
        children: [
          new TextRun({
            text: AMC_FOOTER.address,
            color: toneHex.muted,
            size: half(AMC_DOC_PT.footer),
          }),
          sep(),
          new TextRun({
            text: AMC_FOOTER.phone,
            color: toneHex.muted,
            size: half(AMC_DOC_PT.footer),
          }),
          sep(),
          new TextRun({
            text: AMC_FOOTER.hotline,
            bold: true,
            color: toneHex.brand,
            size: half(AMC_DOC_PT.footer),
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            color: toneHex.muted,
            size: half(AMC_DOC_PT.footer),
            children: [
              "Page ",
              PageNumber.CURRENT,
              " of ",
              PageNumber.TOTAL_PAGES_IN_SECTION,
            ],
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "Yalla Fix It",
    title,
    styles: {
      default: {
        document: {
          run: {
            font: "Arial",
            size: half(AMC_DOC_PT.body),
            color: toneHex.default,
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "amc-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 400, hanging: 260 } },
                run: { color: toneHex.brand },
              },
            },
          ],
        },
      ],
    },
    sections: [
      /* The cover: the artwork, full page, behind an empty page. */
      ...(cover
        ? [
            {
              properties: {
                page: {
                  size: { width: PAGE_W, height: PAGE_H },
                  margin: { top: 0, right: 0, bottom: 0, left: 0 },
                },
              },
              children: [
                new Paragraph({
                  children: [
                    new ImageRun({
                      type: "png",
                      data: cover,
                      transformation: { width: px(8.27), height: px(11.69) },
                      floating: {
                        horizontalPosition: {
                          relative: HorizontalPositionRelativeFrom.PAGE,
                          offset: 0,
                        },
                        verticalPosition: {
                          relative: VerticalPositionRelativeFrom.PAGE,
                          offset: 0,
                        },
                        behindDocument: true,
                      },
                    }),
                  ],
                }),
              ],
            },
          ]
        : []),
      {
        properties: {
          ...(cover ? { type: SectionType.NEXT_PAGE } : {}),
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: {
              top: 1500,
              right: MARGIN_X,
              bottom: 1100,
              left: MARGIN_X,
              header: 400,
              footer: 400,
            },
            pageNumbers: { start: 1 },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: model.blocks.flatMap((block) => renderBlock(block, photos)),
      },
    ],
  });

  return Packer.toBlob(doc);
}
