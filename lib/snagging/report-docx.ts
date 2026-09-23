import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";

import {
  loadPhoto,
  type Photo,
} from "@/components/dashboard/extensions/amc/amc-docx";
import { AMC_BRAND_IMAGES } from "@/components/dashboard/extensions/amc/templates/amc-doc/amc-doc-theme";
import type { SnaggingQuotation } from "@/modules/snagging";
import type { SnaggingSnag, SnaggingTask } from "@/types/types";

/**
 * The snagging inspection report as an editable Word file.
 *
 * Drawn to match the PDF page for page: the same cover table and severity
 * legend, the same summary figures, the same floor plan, and the same
 * defect cards — the photograph beside the details, with the grade and the
 * state tagged and the severity carried down the left edge of the card.
 *
 * It is a separate file from the AMC Word builder because the two
 * documents are set differently; the report follows the report.
 */

/* A4 in twentieths of a point, with the PDF's margins. */
const PAGE_W = 11906;
const MARGIN_X = 720;
const MARGIN_Y = 720;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

/* The report's palette (see inspection-report.tsx). */
const C = {
  brand: "C13D3C",
  deep: "AA272B",
  orange: "FF7800",
  ink: "17181C",
  body: "33373F",
  sub: "666D78",
  faint: "8B919B",
  line: "ECECF0",
  grid: "BFBFBF",
  label: "F2F2F2",
  card: "FAFAFB",
} as const;

const TONE: Record<string, { fg: string; fill: string }> = {
  high: { fg: "C81E3A", fill: "FFC0C7" },
  medium: { fg: "B3720A", fill: "FFE4CC" },
  low: { fg: "2255B3", fill: "FAF6DF" },
  pass: { fg: "1E8A4C", fill: "D7E7B5" },
};

const SEVERITY: Record<string, { label: string; tone: keyof typeof TONE }> = {
  high: { label: "High", tone: "high" },
  medium: { label: "Medium", tone: "medium" },
  low: { label: "Low", tone: "low" },
  conformity: { label: "Conformity", tone: "pass" },
};

const STATE: Record<string, string> = {
  verified_closed: "Closed",
  verified_poor_quality: "Re-inspected: poor quality fix",
  verified_not_done: "Re-inspected: not done",
  fixed: "Fixed, to re-check",
  open: "Open",
};

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

const half = (points: number) => Math.round(points * 2);

type TableCellValign = NonNullable<
  ConstructorParameters<typeof TableCell>[0]["verticalAlign"]
>;

const NO_BORDER: IBorderOptions = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF",
};
const gridBorder = (color: string = C.grid): IBorderOptions => ({
  style: BorderStyle.SINGLE,
  size: 4,
  color,
});
const cellBorders = (
  overrides: Partial<
    Record<"top" | "bottom" | "left" | "right", IBorderOptions>
  > = {},
) => ({
  top: gridBorder(),
  bottom: gridBorder(),
  left: gridBorder(),
  right: gridBorder(),
  ...overrides,
});

type TextBit = {
  text: string;
  bold?: boolean;
  color?: string;
  size?: number;
  caps?: boolean;
};

function text(
  bits: TextBit[] | string,
  fallbackColor: string = C.body,
): ParagraphChild[] {
  const list = typeof bits === "string" ? [{ text: bits }] : bits;
  return list.map(
    (bit) =>
      new TextRun({
        text: bit.text,
        bold: bit.bold,
        color: bit.color ?? fallbackColor,
        size: half(bit.size ?? 9.5),
        allCaps: bit.caps,
      }),
  );
}

function para(
  bits: TextBit[] | string,
  options: {
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacing?: { before?: number; after?: number };
    color?: string;
  } = {},
) {
  return new Paragraph({
    children: text(bits, options.color),
    alignment: options.align,
    spacing: {
      before: options.spacing?.before ?? 0,
      after: options.spacing?.after ?? 60,
      line: 260,
    },
  });
}

/* A red section heading over the orange hairline, as the report sets one. */
function heading(label: string) {
  return new Paragraph({
    children: text([{ text: label, bold: true, size: 11, color: C.brand }]),
    spacing: { before: 260, after: 100 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: C.orange, space: 3 },
    },
    keepNext: true,
  });
}

function cell(
  children: (Paragraph | Table)[],
  options: {
    width?: number;
    fill?: string;
    borders?: ReturnType<typeof cellBorders>;
    columnSpan?: number;
    valign?: TableCellValign;
  } = {},
) {
  return new TableCell({
    children:
      children.length > 0 ? children : [new Paragraph({ children: [] })],
    width: options.width
      ? { size: options.width, type: WidthType.DXA }
      : undefined,
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill }
      : undefined,
    borders: options.borders ?? cellBorders(),
    columnSpan: options.columnSpan,
    verticalAlign: options.valign ?? VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
  });
}

function table(rows: TableRow[], columnWidths: number[]) {
  return new Table({
    rows,
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths,
    borders: {
      top: gridBorder(),
      bottom: gridBorder(),
      left: gridBorder(),
      right: gridBorder(),
      insideHorizontal: gridBorder(C.line),
      insideVertical: gridBorder(C.line),
    },
  });
}

function imageRun(photo: Photo, maxWidthPx: number, maxHeightPx: number) {
  const scale = Math.min(
    maxWidthPx / photo.width,
    maxHeightPx / photo.height,
    1,
  );
  return new ImageRun({
    type: "jpg",
    data: photo.data,
    transformation: {
      width: Math.round(photo.width * scale),
      height: Math.round(photo.height * scale),
    },
  });
}

/*
  A floor plan with its defect pins drawn into it.

  Word cannot lay a marker over a picture the way the page does, so the
  plan is painted onto a canvas with the numbered dots on top and the
  result is what goes into the document. Same colours, same numbers as the
  PDF, so a client reading either sees the same plan.
*/
async function renderPlanWithPins(
  url: string,
  pins: { x: number; y: number; number: number; severity: string }[],
): Promise<Photo | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, 1400 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    /* Sized off the plan, so a big plan does not get pinhead dots and a
       small one is not covered in discs. */
    const radius = Math.max(
      11,
      Math.round(Math.min(canvas.width, canvas.height) * 0.016),
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(radius * 1.15)}px Arial, sans-serif`;
    for (const pin of pins) {
      const x = pin.x * canvas.width;
      const y = pin.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle =
        pin.severity === "high"
          ? "#a81d1d"
          : pin.severity === "medium"
            ? "#b45309"
            : "#475569";
      ctx.fill();
      ctx.lineWidth = Math.max(2, radius * 0.18);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(pin.number), x, y + radius * 0.05);
    }

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

function areaLetter(index: number): string {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function planName(label: string): string {
  const cleaned = label
    .replace(/\.(png|jpe?g|webp|gif|pdf|svg)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : label;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

function fmtTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function isPhoto(photo: {
  media_type?: string | null;
  storage_path?: string | null;
}) {
  if (photo.media_type === "video") return false;
  return !/\.(mp4|mov|m4v|webm|qt)$/i.test(photo.storage_path ?? "");
}

function unitNumber(label?: string | null): string {
  if (!label) return "—";
  return label.replace(/^\s*(unit|apt\.?|apartment)\s+/i, "").trim() || label;
}

/* label | value, the cover table's pair. */
function factCells(label: string, value: string, widths: [number, number]) {
  return [
    cell([para([{ text: `${label}:`, size: 9 }], { color: C.ink })], {
      width: widths[0],
      fill: C.label,
    }),
    cell([para([{ text: value || "—", size: 9 }], { color: C.ink })], {
      width: widths[1],
    }),
  ];
}

export async function generateInspectionReportDocx(
  task: SnaggingTask,
  quotation?: SnaggingQuotation | null,
): Promise<Blob> {
  const property = task.property;
  const areas = task.areas ?? [];
  const snags = (task.snags ?? []).filter(
    (snag) => task.visit_type !== "desnag" || snag.status !== "verified_closed",
  );
  const inspector = task.assignees?.find(
    (a) => a.role === "technician",
  )?.user_profile;
  const submission = task.submissions?.[0];
  const place = [property?.building_name, property?.unit_label]
    .filter(Boolean)
    .join(", ");

  const byArea = new Map<string, SnaggingSnag[]>();
  for (const snag of snags) {
    const key = snag.area?.id ?? snag.area_id ?? "unassigned";
    byArea.set(key, [...(byArea.get(key) ?? []), snag]);
  }

  /* Numbered in the order the defects are listed, as the cards number
     them, so a pin on the plan and its card agree. */
  const defectNumber = new Map<string, number>();
  for (const area of areas) {
    for (const snag of byArea.get(area.id) ?? []) {
      defectNumber.set(snag.id, defectNumber.size + 1);
    }
  }

  /* Every photograph and plan, fetched once. */
  const urls = new Set<string>();
  for (const snag of snags) {
    for (const photo of snag.photos ?? []) {
      if (photo.signed_url && isPhoto(photo)) urls.add(photo.signed_url);
    }
  }
  const [logo, isoBadges, ...loaded] = await Promise.all([
    loadPhoto(AMC_BRAND_IMAGES.logoTrimmed),
    Promise.all(AMC_BRAND_IMAGES.iso.map((badge) => loadPhoto(badge.src))),
    ...[...urls].map(async (url) => [url, await loadPhoto(url)] as const),
  ]);
  const photos = new Map(loaded as [string, Photo | null][]);

  /* The plans, each painted with the pins that sit on it. */
  const plans = (task.floor_plans ?? []).filter((plan) => plan.signed_url);
  const plannedImages = new Map(
    await Promise.all(
      plans.map(async (plan) => {
        const pins = snags
          .filter(
            (snag) =>
              snag.floor_plan_id === plan.id &&
              snag.pin_x != null &&
              snag.pin_y != null &&
              defectNumber.has(snag.id),
          )
          .map((snag) => ({
            x: snag.pin_x as number,
            y: snag.pin_y as number,
            number: defectNumber.get(snag.id) as number,
            severity: snag.severity,
          }));
        return [
          plan.id,
          await renderPlanWithPins(plan.signed_url as string, pins),
        ] as const;
      }),
    ),
  );

  const count = (severity: string) =>
    snags.filter((s) => s.severity === severity).length;
  const countAreas = (needle: string) =>
    areas.filter((area) => area.name?.toLowerCase().includes(needle)).length;
  const rechecked = snags.filter((s) =>
    ["verified_closed", "verified_poor_quality", "verified_not_done"].includes(
      s.status ?? "",
    ),
  ).length;

  const body: (Paragraph | Table)[] = [];

  /* ── Cover ── */
  if (logo) {
    body.push(
      new Paragraph({
        children: [imageRun(logo, 190, 80)],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
    );
  }
  body.push(
    new Paragraph({
      children: [
        ...text([
          {
            text: "Property handover snagging report",
            bold: true,
            size: 12,
            caps: true,
            color: C.brand,
          },
        ]),
        new TextRun({ text: "\t" }),
        ...text([
          {
            text: "Call: 800-Perfect",
            bold: true,
            size: 12,
            caps: true,
            color: C.brand,
          },
        ]),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      spacing: { after: 160 },
    }),
  );
  body.push(
    new Paragraph({
      children: text([
        {
          text: "Project information",
          bold: true,
          size: 11,
          color: C.ink,
          caps: true,
        },
      ]),
      spacing: { after: 80 },
      keepNext: true,
    }),
  );

  const w = [Math.round(CONTENT_W * 0.18), Math.round(CONTENT_W * 0.32)] as [
    number,
    number,
  ];
  const visitLabel =
    task.visit_type === "desnag"
      ? `De-snag round ${task.round_number}`
      : task.visit_type === "additional"
        ? `Additional visit ${task.round_number}`
        : "Snagging";

  body.push(
    table(
      [
        new TableRow({
          children: [
            ...factCells("Date of inspection", fmtDate(task.appointment_at), w),
            ...factCells("Client name", property?.client_name ?? "—", w),
          ],
        }),
        new TableRow({
          children: [
            ...factCells("Location", place || "—", w),
            ...factCells(
              "Client contact number",
              property?.client_phone ?? "—",
              w,
            ),
          ],
        }),
        new TableRow({
          children: [
            ...factCells("Time of inspection", fmtTime(task.appointment_at), w),
            ...factCells(
              "Client email address",
              property?.client_email ?? "—",
              w,
            ),
          ],
        }),
        new TableRow({
          children: [
            ...factCells("Type of inspection", visitLabel, w),
            ...factCells("Property type", property?.property_type ?? "—", w),
          ],
        }),
        new TableRow({
          children: [
            ...factCells(
              "Recorded by/date",
              [
                inspector?.full_name ?? inspector?.email,
                submission?.signed_at ? fmtDate(submission.signed_at) : null,
              ]
                .filter(Boolean)
                .join(" — ") || "—",
              w,
            ),
            ...factCells(
              "Report prepared",
              fmtDate(new Date().toISOString()),
              w,
            ),
          ],
        }),
        /* The legend, in the colours the defect cards carry. */
        new TableRow({
          children: [
            cell(
              [
                para([{ text: "Legends: (severity grade)", size: 9 }], {
                  color: C.ink,
                }),
              ],
              {
                fill: C.label,
                columnSpan: 4,
              },
            ),
          ],
        }),
        new TableRow({
          children: (["high", "medium", "low", "pass"] as const).map((tone) =>
            cell(
              [
                para(
                  [
                    {
                      text:
                        tone === "pass" ? "Conformity" : SEVERITY[tone].label,
                      bold: true,
                      size: 9,
                      caps: true,
                      color: TONE[tone].fg,
                    },
                  ],
                  { align: AlignmentType.CENTER },
                ),
              ],
              { fill: TONE[tone].fill },
            ),
          ),
        }),
      ],
      [w[0], w[1], w[0], w[1]],
    ),
  );

  /* ── Property description ── */
  const description = [
    property?.bedrooms
      ? `${NUMBER_WORDS[property.bedrooms] ?? property.bedrooms}-bedroom ${property.property_type ?? "property"}`
      : (property?.property_type ?? "Property"),
    countAreas("bath") > 0
      ? `with ${NUMBER_WORDS[countAreas("bath")] ?? countAreas("bath")} bathroom${countAreas("bath") === 1 ? "" : "s"}`
      : null,
    countAreas("balcon") > 0 ? "and a balcony" : null,
  ]
    .filter(Boolean)
    .join(" ");

  body.push(heading("Property description"));
  body.push(para(description || "—"));
  areas.forEach((area, index) => {
    body.push(
      new Paragraph({
        children: text([
          { text: `${areaLetter(index)}.  ${area.name ?? "Area"}`, size: 9.5 },
        ]),
        indent: { left: 360 },
        spacing: { after: 40, line: 240 },
      }),
    );
  });

  /* ── Summary ── */
  body.push(heading("Summary"));
  const figure = (
    label: string,
    value: string,
    fill?: string,
    color: string = C.ink,
  ) =>
    cell(
      [
        para([{ text: value, bold: true, size: 16, color }], {
          align: AlignmentType.CENTER,
        }),
        para(
          [{ text: label, bold: true, size: 7.5, caps: true, color: C.sub }],
          {
            align: AlignmentType.CENTER,
          },
        ),
      ],
      { fill, width: Math.round(CONTENT_W / 5) },
    );
  body.push(
    table(
      [
        new TableRow({
          children: [
            figure("Total snags", String(snags.length)),
            figure("High", String(count("high")), TONE.high.fill, TONE.high.fg),
            figure(
              "Medium",
              String(count("medium")),
              TONE.medium.fill,
              TONE.medium.fg,
            ),
            figure("Low", String(count("low")), TONE.low.fill, TONE.low.fg),
            figure("Defects re-checked", `${rechecked}/${snags.length}`),
          ],
        }),
      ],
      Array.from({ length: 5 }, () => Math.round(CONTENT_W / 5)),
    ),
  );

  /* ── Areas not fully reached ── */
  const accessIssues = areas.filter(
    (area) => area.access_state && area.access_state !== "accessible",
  );
  if (accessIssues.length > 0) {
    body.push(heading("Areas not fully inspected"));
    body.push(
      table(
        accessIssues.map(
          (area) =>
            new TableRow({
              children: [
                cell(
                  [
                    para([
                      {
                        text: area.name ?? "Area",
                        bold: true,
                        size: 9.5,
                        color: C.ink,
                      },
                    ]),
                  ],
                  {
                    width: Math.round(CONTENT_W * 0.4),
                  },
                ),
                cell(
                  [
                    para([
                      {
                        text:
                          (area.access_state ?? "").replace(/_/g, " ") +
                          (area.access_reason
                            ? ` — ${area.access_reason}`
                            : ""),
                        size: 9.5,
                      },
                    ]),
                  ],
                  { width: Math.round(CONTENT_W * 0.6) },
                ),
              ],
            }),
        ),
        [Math.round(CONTENT_W * 0.4), Math.round(CONTENT_W * 0.6)],
      ),
    );
  }

  /* ── Floor plans ── */
  if (plans.length > 0) {
    body.push(heading("Floor plan"));
    body.push(
      para([
        {
          text: "Every defect where it was found. The numbers match the list that follows.",
          size: 9,
          color: C.sub,
        },
      ]),
    );
    for (const plan of plans) {
      const image =
        plannedImages.get(plan.id) ?? photos.get(plan.signed_url as string);
      body.push(
        new Paragraph({
          children: text([
            {
              text: planName(plan.label ?? "Floor plan"),
              bold: true,
              size: 10,
              color: C.ink,
            },
          ]),
          spacing: { before: 120, after: 60 },
          keepNext: true,
        }),
      );
      if (image) {
        body.push(
          new Paragraph({
            children: [imageRun(image, 660, 560)],
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
          }),
        );
      }
    }
  }

  /* ── The defects, as the cards read ── */
  body.push(
    new Paragraph({
      children: [
        ...text([
          {
            text: `${property?.building_name ?? "Property"}, apartment number `,
            size: 11,
            color: C.ink,
          },
        ]),
        ...text([
          {
            text: unitNumber(property?.unit_label),
            bold: true,
            size: 11,
            color: C.deep,
          },
        ]),
      ],
      spacing: { before: 300, after: 120 },
      keepNext: true,
    }),
  );

  let running = 0;
  const round = task.round_number ?? 1;
  areas.forEach((area, areaIndex) => {
    const areaSnags = byArea.get(area.id) ?? [];
    const letter = areaLetter(areaIndex);

    body.push(
      new Paragraph({
        children: [
          ...text([
            {
              text: `${letter}. ${area.name ?? "Area"}`,
              bold: true,
              size: 10,
              color: C.ink,
            },
          ]),
          ...(areaSnags.length === 0
            ? text([
                {
                  text:
                    area.access_state === "not_accessible"
                      ? " — not inspected"
                      : " — no defects found",
                  size: 9.5,
                  color: C.sub,
                },
              ])
            : []),
        ],
        spacing: { before: 180, after: 80 },
        keepNext: areaSnags.length > 0,
      }),
    );

    for (const [index, snag] of areaSnags.entries()) {
      running += 1;
      const grade = SEVERITY[snag.severity] ?? SEVERITY.low;
      const tone = TONE[grade.tone];
      const reference = `${String(running).padStart(3, "0")}-${letter}-${String(index + 1).padStart(2, "0")}`;
      const title =
        snag.defect_label ||
        snag.element_label ||
        snag.category_label ||
        "Defect";
      const path = [
        ...new Set(
          [snag.category_label, snag.element_label].filter(
            (part): part is string => Boolean(part?.trim()),
          ),
        ),
      ].join(" · ");
      const state = STATE[snag.status ?? "open"] ?? "Open";

      const all = (snag.photos ?? []).filter((p) => p.signed_url && isPhoto(p));
      const carried =
        task.visit_type === "desnag" && (snag.round_created ?? 1) < round;
      const before = all.filter((p) => (p.round_number ?? 1) < round);
      const after = all.filter((p) => (p.round_number ?? 1) >= round);
      const pair = carried
        ? [
            { label: "Before", photo: before[0] },
            { label: "After", photo: after[after.length - 1] },
          ]
        : [{ label: "Evidence", photo: all[0] }];

      const photoCells = pair.map(({ label, photo }) => {
        const image = photo?.signed_url ? photos.get(photo.signed_url) : null;
        return cell(
          [
            image
              ? new Paragraph({
                  children: [imageRun(image, pair.length > 1 ? 210 : 300, 170)],
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 40 },
                })
              : para([{ text: "No photo", size: 9, color: C.faint }], {
                  align: AlignmentType.CENTER,
                }),
            para(
              [
                {
                  text: label,
                  bold: true,
                  size: 7.5,
                  caps: true,
                  color: label === "After" ? C.brand : C.ink,
                },
              ],
              {
                align: AlignmentType.CENTER,
              },
            ),
          ],
          {
            borders: cellBorders({
              left: NO_BORDER,
              right: NO_BORDER,
              top: NO_BORDER,
            }),
          },
        );
      });

      const widths = [
        Math.round(CONTENT_W * 0.58),
        CONTENT_W - Math.round(CONTENT_W * 0.58),
      ];

      body.push(
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: widths,
          rows: [
            /* The header band: number, defect, reference and where, with
               the grade and the state tagged on the right. */
            new TableRow({
              children: [
                cell(
                  [
                    new Paragraph({
                      children: [
                        ...text([
                          {
                            text: `${running}. `,
                            bold: true,
                            size: 11,
                            color: tone.fg,
                          },
                        ]),
                        ...text([
                          { text: title, bold: true, size: 11, color: C.ink },
                        ]),
                      ],
                      spacing: { after: 20 },
                    }),
                    para([
                      {
                        text: [reference, area.name]
                          .filter(Boolean)
                          .join("  ·  "),
                        size: 8,
                        color: C.sub,
                      },
                    ]),
                  ],
                  {
                    width: widths[0],
                    fill: C.card,
                    valign: VerticalAlign.TOP,
                    borders: cellBorders({
                      left: {
                        style: BorderStyle.SINGLE,
                        size: 18,
                        color: tone.fg,
                      },
                      right: NO_BORDER,
                      bottom: gridBorder(C.line),
                    }),
                  },
                ),
                cell(
                  [
                    para(
                      [
                        {
                          text: grade.label,
                          bold: true,
                          size: 8.5,
                          caps: true,
                          color: tone.fg,
                        },
                      ],
                      {
                        align: AlignmentType.RIGHT,
                      },
                    ),
                    para([{ text: state, size: 8, color: C.sub }], {
                      align: AlignmentType.RIGHT,
                    }),
                  ],
                  {
                    width: widths[1],
                    fill: C.card,
                    valign: VerticalAlign.TOP,
                    borders: cellBorders({
                      left: NO_BORDER,
                      bottom: gridBorder(C.line),
                    }),
                  },
                ),
              ],
            }),
            /* The evidence beside the details. */
            new TableRow({
              children: [
                cell(
                  [
                    new Table({
                      width: { size: widths[0] - 200, type: WidthType.DXA },
                      columnWidths: photoCells.map(() =>
                        Math.round((widths[0] - 200) / photoCells.length),
                      ),
                      borders: {
                        top: NO_BORDER,
                        bottom: NO_BORDER,
                        left: NO_BORDER,
                        right: NO_BORDER,
                        insideHorizontal: NO_BORDER,
                        insideVertical: NO_BORDER,
                      },
                      rows: [new TableRow({ children: photoCells })],
                    }),
                  ],
                  {
                    width: widths[0],
                    valign: VerticalAlign.TOP,
                    borders: cellBorders({
                      left: {
                        style: BorderStyle.SINGLE,
                        size: 18,
                        color: tone.fg,
                      },
                      right: NO_BORDER,
                      top: NO_BORDER,
                    }),
                  },
                ),
                cell(
                  [
                    ...(path
                      ? [
                          para([
                            {
                              text: "Category",
                              bold: true,
                              size: 7.5,
                              caps: true,
                              color: C.faint,
                            },
                          ]),
                          para([{ text: path, size: 9.5 }]),
                        ]
                      : []),
                    para(
                      [
                        {
                          text: "Comment",
                          bold: true,
                          size: 7.5,
                          caps: true,
                          color: C.faint,
                        },
                      ],
                      {
                        spacing: { before: 60 },
                      },
                    ),
                    para(
                      snag.note
                        ? [{ text: snag.note, size: 9.5 }]
                        : [
                            {
                              text: "No comment recorded.",
                              size: 9.5,
                              color: C.faint,
                            },
                          ],
                    ),
                    ...(state.startsWith("Re-inspected")
                      ? [
                          para(
                            [
                              {
                                text: state,
                                bold: true,
                                size: 9,
                                color: C.deep,
                              },
                            ],
                            {
                              spacing: { before: 80 },
                            },
                          ),
                        ]
                      : []),
                  ],
                  {
                    width: widths[1],
                    valign: VerticalAlign.TOP,
                    borders: cellBorders({ left: NO_BORDER, top: NO_BORDER }),
                  },
                ),
              ],
            }),
          ],
        }),
      );
      body.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    }
  });

  /* ── Commercial summary ── */
  if (quotation) {
    body.push(heading("Commercial summary"));
    body.push(
      table(
        [
          ...quotation.lines.map(
            (line) =>
              new TableRow({
                children: [
                  cell([para([{ text: line.description ?? "—", size: 9.5 }])], {
                    width: Math.round(CONTENT_W * 0.6),
                  }),
                  cell(
                    [
                      para(
                        [
                          {
                            text:
                              `${line.qty ?? ""} ${line.unit ?? ""}`.trim() ||
                              "—",
                            size: 9.5,
                          },
                        ],
                        {
                          align: AlignmentType.RIGHT,
                        },
                      ),
                    ],
                    { width: Math.round(CONTENT_W * 0.15) },
                  ),
                  cell(
                    [
                      para(
                        [
                          {
                            text: `${quotation.currency} ${Number(line.amount).toLocaleString()}`,
                            size: 9.5,
                          },
                        ],
                        { align: AlignmentType.RIGHT },
                      ),
                    ],
                    { width: Math.round(CONTENT_W * 0.25) },
                  ),
                ],
              }),
          ),
          new TableRow({
            children: [
              cell(
                [para([{ text: "Total", bold: true, size: 10, color: C.ink }])],
                {
                  width: Math.round(CONTENT_W * 0.6),
                },
              ),
              cell([], { width: Math.round(CONTENT_W * 0.15) }),
              cell(
                [
                  para(
                    [
                      {
                        text: `${quotation.currency} ${Number(quotation.total).toLocaleString()}`,
                        bold: true,
                        size: 10,
                        color: C.ink,
                      },
                    ],
                    { align: AlignmentType.RIGHT },
                  ),
                ],
                { width: Math.round(CONTENT_W * 0.25) },
              ),
            ],
          }),
        ],
        [
          Math.round(CONTENT_W * 0.6),
          Math.round(CONTENT_W * 0.15),
          Math.round(CONTENT_W * 0.25),
        ],
      ),
    );
  }

  /* ── Outlines: the closing page ── */
  body.push(heading("Outlines"));
  body.push(
    para(
      snags.length === 0
        ? "The property was found in acceptable condition, with no defects recorded at this inspection."
        : `The property was found in acceptable condition with comments, with ${snags.length} finishing and workmanship comment${snags.length === 1 ? "" : "s"}, listed above.`,
    ),
  );
  if (inspector?.full_name || submission?.signed_at) {
    body.push(
      para([
        { text: "Inspected by " },
        {
          text: inspector?.full_name ?? inspector?.email ?? "—",
          bold: true,
          color: C.ink,
        },
        {
          text: submission?.signed_at
            ? ` · signed off ${fmtDate(submission.signed_at)}`
            : "",
        },
      ]),
    );
  }
  body.push(
    para([
      {
        text: "This report records the condition observed at the time of inspection. Defects are classified by severity for prioritisation and do not constitute a structural or legal certification.",
        size: 8,
        color: C.sub,
      },
    ]),
  );

  /* The running head and the footer, drawn on every page. */
  const header = new Header({
    children: [
      new Paragraph({
        children: [
          ...(logo ? [imageRun(logo, 95, 40)] : []),
          new TextRun({ text: "  " }),
          ...text([
            {
              text: `Property handover snagging report${place ? ` · ${place}` : ""}`,
              bold: true,
              size: 8,
              color: C.brand,
            },
          ]),
          new TextRun({ text: "\t" }),
          ...isoBadges
            .filter((badge): badge is Photo => Boolean(badge))
            .flatMap((badge) => [
              imageRun(badge, 26, 26),
              new TextRun({ text: " " }),
            ]),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: C.brand,
            space: 4,
          },
        },
        spacing: { after: 160 },
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `${property?.unit_label ?? "Inspection"} · Snagging inspection report · Page `,
            size: half(7.5),
            color: C.faint,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            size: half(7.5),
            color: C.faint,
          }),
          new TextRun({ text: " of ", size: half(7.5), color: C.faint }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: half(7.5),
            color: C.faint,
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "Yalla Fix It",
    title: `Snagging inspection report${place ? ` — ${place}` : ""}`,
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: half(9.5), color: C.body },
          paragraph: { spacing: { line: 260, after: 60 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: 16838 },
            margin: {
              top: MARGIN_Y,
              bottom: MARGIN_Y,
              left: MARGIN_X,
              right: MARGIN_X,
            },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: body,
      },
    ],
  });

  return Packer.toBlob(doc);
}
