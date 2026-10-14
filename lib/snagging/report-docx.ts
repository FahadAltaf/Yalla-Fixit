import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
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
import { shortSnagId } from "@/lib/snagging/snag-id";
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

/*
  "No border", as a white hairline rather than none: Word draws its dashed
  on-screen gridlines wherever a cell edge has no border at all, which made
  the cards look ruled in a way the PDF is not. White on the white page
  reads as nothing, on screen and in print.
*/
const NO_BORDER: IBorderOptions = {
  style: BorderStyle.SINGLE,
  size: 2,
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

/* A section heading as the PDF sets one: brand red, plain, no rule. */
function heading(label: string) {
  return new Paragraph({
    children: text([{ text: label, size: 11, color: C.brand }]),
    spacing: { before: 260, after: 100 },
    keepNext: true,
  });
}

/* A table with no lines of its own, for layout inside a card. */
const BARE = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
};
const NO_CELL_BORDERS = () =>
  cellBorders({ top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

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
  pins: { x: number; y: number; number: string; severity: string }[],
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
      // A pill as wide as the snag ID ("S004"), a circle for a short one.
      const label = String(pin.number);
      const pillW = Math.max(radius * 2, ctx.measureText(label).width + radius);
      ctx.beginPath();
      ctx.roundRect(x - pillW / 2, y - radius, pillW, radius * 2, radius);
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
      ctx.fillText(label, x, y + radius * 0.05);
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

/*
  A photo cut to the box the PDF shows it in (object-fit: cover), with the
  same rounded corners. Placed at its own shape, a portrait photo came out
  as a tall narrow strip beside the details.
*/
async function coverCrop(photo: Photo, width: number, height: number): Promise<Photo> {
  try {
    const bitmap = await createImageBitmap(new Blob([photo.data as BlobPart], { type: "image/jpeg" }));
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return photo;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 6 * scale);
    ctx.clip();
    const ratio = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const w = bitmap.width * ratio;
    const h = bitmap.height * ratio;
    ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!jpeg) return photo;
    return { data: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height };
  } catch {
    return photo;
  }
}

/* A chart bar as the PDF draws it: a rounded track, filled to its share. */
function barImage(share: number, color: string): Photo | null {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ECECF0";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
  ctx.fill();
  ctx.fillStyle = `#${color}`;
  ctx.beginPath();
  ctx.roundRect(0, 0, Math.max(12, (canvas.width * Math.max(2, share)) / 100), canvas.height, 8);
  ctx.fill();
  const url = canvas.toDataURL("image/jpeg", 0.9);
  const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
  return { data: bytes, width: canvas.width, height: canvas.height };
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
  const [logo, signature, ...loaded] = await Promise.all([
    loadPhoto(AMC_BRAND_IMAGES.logoTrimmed),
    /*
      The one signature the client is shown, as on the PDF and the report
      page: the job's own, or one inspector's sign-off when a job with
      several inspectors carries none (job-detail-sections). One that
      fails to load is left out rather than failing the file.
    */
    submission?.signature_url ? loadPhoto(submission.signature_url) : Promise.resolve(null),
    ...[...urls].map(async (url) => [url, await loadPhoto(url)] as const),
  ]);
  const photos = new Map(loaded as [string, Photo | null][]);
  /* Each photo cut to the PDF's boxes: one wide, or a pair side by side. */
  const SINGLE_BOX = { w: 330, h: 170 };
  const PAIR_BOX = { w: 200, h: 150 };
  const cropped = new Map<string, Photo>();
  await Promise.all(
    [...photos.entries()].map(async ([url, photo]) => {
      if (!photo) return;
      const [single, pair] = await Promise.all([
        coverCrop(photo, SINGLE_BOX.w, SINGLE_BOX.h),
        coverCrop(photo, PAIR_BOX.w, PAIR_BOX.h),
      ]);
      cropped.set(`${url}|single`, single);
      cropped.set(`${url}|pair`, pair);
    }),
  );

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
            // The snag's ID on its pin, as the PDF and the app show it (SNG-097).
            number: shortSnagId(snag.snag_code) ?? String(defectNumber.get(snag.id)),
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
        ? "Additional visit"
        : "Snagging";

  /* The inspectors, as the PDF names them on its cover. */
  const inspectorNames = (task.assignees ?? [])
    .filter((a) => a.role === "technician")
    .map((a) => a.user_profile?.full_name ?? a.user_profile?.email)
    .filter((name): name is string => Boolean(name));
  const recordedBy = [
    inspectorNames.length > 0 ? inspectorNames.join(", ") : null,
    submission?.signed_at ? fmtDate(submission.signed_at) : null,
  ]
    .filter(Boolean)
    .join(" — ");

  body.push(
    table(
      [
        new TableRow({
          children: [
            ...factCells("Date of inspection", fmtDate(task.scheduled_date), w),
            ...factCells("Client name", property?.client_name ?? "—", w),
          ],
        }),
        new TableRow({
          children: [
            cell([para([{ text: "Location:", size: 9 }], { color: C.ink })], {
              width: w[0],
              fill: C.label,
            }),
            cell(
              [
                para(
                  [
                    {
                      text:
                        [property?.building_name, property?.unit_label]
                          .filter(Boolean)
                          .join(" — ") || "—",
                      bold: true,
                      size: 9,
                    },
                  ],
                  { color: C.ink },
                ),
              ],
              { width: w[1] + w[0] + w[1], columnSpan: 3 },
            ),
          ],
        }),
        new TableRow({
          children: [
            ...factCells("Time of inspection", fmtTime(task.appointment_at), w),
            ...factCells("Client contact number", property?.client_phone ?? "—", w),
          ],
        }),
        new TableRow({
          children: [
            ...factCells("Type of inspection", visitLabel, w),
            ...factCells("Client email address", property?.client_email ?? "—", w),
          ],
        }),
        new TableRow({
          children: [
            ...factCells("Recorded by/date", recordedBy || "—", w),
            ...factCells("Package", "Handover snagging", w),
          ],
        }),
        new TableRow({
          children: [
            ...factCells("Report prepared by/date", fmtDate(new Date().toISOString()), w),
            ...factCells("Property type", property?.property_type ?? "—", w),
          ],
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
    countAreas("balcon") > 0
      ? `and ${NUMBER_WORDS[countAreas("balcon")] ?? countAreas("balcon")} balcony`
      : null,
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

  /*
    ── Definition, the limits of the inspection, Overview, General remarks ──

    The PDF's opening pages, word for word. The Word file went from the
    rooms straight to the figures, which is the "information missing"
    the office found when they put the two side by side (SNG-140).
  */
  const highCount = count("high");
  body.push(heading("Definition"));
  body.push(
    para(
      "Snagging is identifying internal and external defects before the developer hands over the property to you. The purpose of a snagging is to report any defects of your property to the developer prior to formal handover, to record the handover condition and/or fix the defects as reported.",
    ),
    para(
      "The YFI trained team inspected the property and prepared this report with reference pictures, to gauge the overall workmanship and the quality of the material used against standard construction norms. Where the approved design and technical parameters of MEP services are shared prior to inspection, the current specification is compared against them. Otherwise the visual inspection is based on construction industry standards, with no comment on design perspective, assuming the contractor follows the design given by the consultant of the project.",
    ),
    para(
      "The inspection is limited to the parts of the building which are visible and/or accessible. YALLA FIX IT have not removed any panelling, furniture or floor coverings. External features are viewed and inspected from available areas at ground level; therefore we are not able to report on any unexposed or inaccessible areas of the property to confirm their condition.",
    ),
  );
  body.push(heading("Overview"));
  body.push(
    para([
      { text: `During the inspection, ${(description || "the property").toLowerCase()} ` },
      { text: "unit number ", bold: true },
      { text: unitNumber(property?.unit_label), bold: true, color: C.deep },
      ...(property?.building_name ? [{ text: `, ${property.building_name}`, bold: true }] : []),
      { text: " was overall found " },
      {
        text: highCount > 0
          ? "not yet acceptable, with the comments below"
          : "in acceptable condition with comments,",
        bold: true,
      },
      { text: " below listed:" },
    ]),
  );
  body.push(heading("General remarks"));
  const gradeGroups = (["high", "medium", "low"] as const)
    .map((grade) => ({ grade, items: snags.filter((snag) => snag.severity === grade) }))
    .filter((group) => group.items.length > 0);
  if (gradeGroups.length === 0) {
    body.push(para("No defects were recorded at this inspection."));
  }
  gradeGroups.forEach((group, index) => {
    body.push(
      new Paragraph({
        children: text([
          { text: `${index + 1}-  `, size: 9.5 },
          {
            text: `${SEVERITY[group.grade].label} severity — ${group.items.length} defect${group.items.length === 1 ? "" : "s"}`,
            bold: true,
            size: 9.5,
          },
        ]),
        indent: { left: 360 },
        spacing: { after: 20, line: 240 },
      }),
      new Paragraph({
        children: text([
          {
            text: [
              ...new Set(group.items.map((snag) => snag.area?.name ?? snag.area_label ?? "Unassigned")),
            ].join(", "),
            size: 9.5,
          },
        ]),
        indent: { left: 720 },
        spacing: { after: 80, line: 240 },
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
            task.visit_type === "desnag"
              ? figure(
                  "Defects re-checked",
                  `${snags.filter((s) => (s.round_created ?? 1) < (task.round_number ?? 1) && s.status !== "pending_verification").length}/${snags.filter((s) => (s.round_created ?? 1) < (task.round_number ?? 1)).length}`,
                )
              : figure(
                  "Areas walked",
                  `${areas.filter((a) => a.confirmed_at || a.visit_id).length}/${areas.length}`,
                ),
          ],
        }),
      ],
      Array.from({ length: 5 }, () => Math.round(CONTENT_W / 5)),
    ),
  );

  /*
    ── What was found, and the most affected sub-categories ──

    The PDF's charts, as tables with the same bars: by severity and by
    category side by side, then the five sub-categories this unit kept
    failing on (SNG-140).
  */
  if (snags.length > 0) {
    const barColor = { high: "C81E3A", medium: "D97706", low: "2255B3" } as const;
    const severityRows = (["high", "medium", "low"] as const)
      .map((grade) => ({ label: SEVERITY[grade].label, value: count(grade), color: barColor[grade] }))
      .filter((row) => row.value > 0);
    const byCategory = new Map<string, number>();
    for (const snag of snags) {
      const key = snag.category_label || snag.element_label || "Uncategorised";
      byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
    }
    const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const categoryRows = ranked.slice(0, 8).map(([label, value]) => ({ label, value, color: C.brand as string }));
    if (ranked.length > 8) {
      categoryRows.push({
        label: `Other (${ranked.length - 8})`,
        value: ranked.slice(8).reduce((sum, [, n]) => sum + n, 0),
        color: C.faint,
      });
    }

    const halfW = Math.floor(CONTENT_W / 2);
    const barCell = (share: number, color: string, width: number) => {
      const bar = barImage(share, color);
      return new Paragraph({
        children: bar
          ? [imageRun(bar, Math.max(40, Math.round(width / 15)), 8)]
          : [],
        spacing: { before: 40, after: 0 },
      });
    };
    const chart = (title: string, rows: { label: string; value: number; color: string }[], width: number) => {
      const labelW = Math.round(width * 0.4);
      const valueW = 900;
      const barW = width - labelW - valueW - 200;
      return [
        para([{ text: title, bold: true, size: 9, color: C.ink }]),
        ...rows.map(
          (row) =>
            new Table({
              rows: [
                new TableRow({
                  children: [
                    cell([para([{ text: row.label, size: 8.5, color: C.ink }])], { width: labelW, borders: cellBorders({ top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }) }),
                    cell([barCell(Math.round((row.value / Math.max(1, snags.length)) * 100), row.color, barW)], { width: barW + 100, borders: cellBorders({ top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }) }),
                    cell(
                      [
                        para(
                          [
                            { text: String(row.value), bold: true, size: 8.5, color: C.ink },
                            { text: `  ${Math.round((row.value / Math.max(1, snags.length)) * 100)}%`, size: 7.5, color: C.sub },
                          ],
                          { align: AlignmentType.RIGHT },
                        ),
                      ],
                      { width: valueW, borders: cellBorders({ top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }) },
                    ),
                  ],
                }),
              ],
              width: { size: width - 200, type: WidthType.DXA },
              columnWidths: [labelW, barW + 100, valueW],
              borders: BARE,
            }),
        ),
      ];
    };

    body.push(heading("What was found"));
    body.push(
      table(
        [
          new TableRow({
            cantSplit: true,
            children: [
              cell(chart("By severity", severityRows, halfW), { width: halfW, fill: C.card, valign: VerticalAlign.TOP }),
              cell(chart("By category", categoryRows, halfW), { width: CONTENT_W - halfW, fill: C.card, valign: VerticalAlign.TOP }),
            ],
          }),
        ],
        [halfW, CONTENT_W - halfW],
      ),
    );

    const subCounts = new Map<string, number>();
    for (const snag of snags) {
      const label = snag.element_label?.trim();
      if (label) subCounts.set(label, (subCounts.get(label) ?? 0) + 1);
    }
    const topSubs = [...subCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([label, value], index) => ({ label: `${index + 1}   ${label}`, value, color: C.brand as string }));
    if (topSubs.length > 0) {
      body.push(heading("Most affected sub-categories"));
      body.push(
        table(
          [new TableRow({ children: [cell(chart("", topSubs, CONTENT_W).slice(1), { width: CONTENT_W, fill: C.card })] })],
          [CONTENT_W],
        ),
      );
    }
  }

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
      // The snag's own code (SNG-097), the one the app and the portal show.
      const reference =
        snag.snag_code ??
        `${String(running).padStart(3, "0")}-${letter}-${String(index + 1).padStart(2, "0")}`;
      const badge = shortSnagId(snag.snag_code) ?? `${running}.`;
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

      /*
        Laid out as the PDF's card: the header band carries the ID, the
        defect, its code and room, and the grade and state as small tags
        on the right; under it the photo, unframed, beside the category
        and comment. A carried defect on a round shows its before and
        after, labelled; a single photo carries no caption.
      */
      const photoCells = pair.map(({ label, photo }) => {
        const image = photo?.signed_url
          ? (cropped.get(`${photo.signed_url}|${pair.length > 1 ? "pair" : "single"}`) ?? null)
          : null;
        return cell(
          [
            ...(pair.length > 1
              ? [
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
                    { spacing: { after: 40 } },
                  ),
                ]
              : []),
            image
              ? new Paragraph({
                  children: [
                    pair.length > 1
                      ? imageRun(image, PAIR_BOX.w, PAIR_BOX.h)
                      : imageRun(image, SINGLE_BOX.w, SINGLE_BOX.h),
                  ],
                  spacing: { after: 0 },
                })
              : para([{ text: "No photo", size: 9, color: C.faint }]),
          ],
          { borders: NO_CELL_BORDERS(), valign: VerticalAlign.TOP },
        );
      });

      const tag = (label: string, fg: string, fill: string) =>
        new TextRun({
          text: ` ${label.toUpperCase()} `,
          bold: true,
          size: half(7.5),
          color: fg,
          shading: { type: ShadingType.CLEAR, color: "auto", fill },
        });
      const reinspected = state.startsWith("Re-inspected");
      const stateTag =
        snag.status === "verified_closed"
          ? tag("Closed", TONE.pass.fg, TONE.pass.fill)
          : (snag.status as string) === "fixed"
            ? tag("Fixed, to re-check", TONE.low.fg, "EAF0FB")
            : reinspected
              ? tag(
                  snag.status === "verified_not_done" ? "Not done" : "Poor quality fix",
                  "FFFFFF",
                  C.deep,
                )
              : tag("Open", C.sub, "F1F1F4");

      const leftW = Math.round(CONTENT_W * 0.5);
      const accent = { style: BorderStyle.SINGLE, size: 18, color: tone.fg };
      body.push(
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [leftW, CONTENT_W - leftW],
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                cell(
                  [
                    new Paragraph({
                      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W - 240 }],
                      children: [
                        ...text([
                          { text: `${badge} `, bold: true, size: 11, color: tone.fg },
                          { text: title, bold: true, size: 11, color: C.ink },
                        ]),
                        new TextRun({ text: "\t" }),
                        tag(grade.label, tone.fg, tone.fill),
                        new TextRun({ text: "  " }),
                        stateTag,
                      ],
                      spacing: { after: 20 },
                    }),
                    para([
                      {
                        text: [reference, area.name].filter(Boolean).join("  ·  "),
                        size: 8,
                        color: C.sub,
                      },
                    ]),
                  ],
                  {
                    columnSpan: 2,
                    fill: C.card,
                    valign: VerticalAlign.TOP,
                    borders: cellBorders({ left: accent, bottom: gridBorder(C.line) }),
                  },
                ),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                cell(
                  [
                    new Table({
                      width: { size: leftW - 200, type: WidthType.DXA },
                      columnWidths: photoCells.map(() =>
                        Math.round((leftW - 200) / photoCells.length),
                      ),
                      borders: BARE,
                      rows: [new TableRow({ children: photoCells })],
                    }),
                  ],
                  {
                    width: leftW,
                    valign: VerticalAlign.TOP,
                    borders: cellBorders({ left: accent, right: NO_BORDER, top: NO_BORDER }),
                  },
                ),
                cell(
                  [
                    ...(path
                      ? [
                          para([{ text: "Category", bold: true, size: 7.5, caps: true, color: C.faint }]),
                          para([{ text: path, size: 9.5 }]),
                        ]
                      : []),
                    para([{ text: "Comment", bold: true, size: 7.5, caps: true, color: C.faint }], {
                      spacing: { before: 60 },
                    }),
                    para(
                      snag.note
                        ? [{ text: snag.note, size: 9.5 }]
                        : [{ text: "No comment recorded.", size: 9.5, color: C.faint }],
                    ),
                    ...(reinspected
                      ? [
                          para(
                            [
                              {
                                text:
                                  snag.status === "verified_not_done"
                                    ? "Re-inspected: the fix has not been done."
                                    : "Re-inspected: the fix is not to standard.",
                                bold: true,
                                size: 9,
                                color: C.deep,
                              },
                            ],
                            { spacing: { before: 80 } },
                          ),
                        ]
                      : []),
                  ],
                  {
                    width: CONTENT_W - leftW,
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
    const money = (value: number | string | null | undefined) =>
      `${quotation.currency} ${Number(value ?? 0).toLocaleString()}`;
    const cw = [Math.round(CONTENT_W * 0.6), Math.round(CONTENT_W * 0.18), 0];
    cw[2] = CONTENT_W - 200 - cw[0] - cw[1];
    const line = (color: string = C.line, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
    const row = (
      cells: [string, string, string],
      options: { bold?: boolean; size?: number; top?: ReturnType<typeof line>; bottom?: ReturnType<typeof line>; mutedMiddle?: boolean } = {},
    ) =>
      new TableRow({
        children: cells.map((value, index) =>
          cell(
            [
              para(
                [
                  {
                    text: value,
                    bold: options.bold || (index === 2 && !options.mutedMiddle && cells[0] !== ""),
                    size: options.size ?? 9.5,
                    color: index === 1 && options.mutedMiddle !== false ? C.sub : C.ink,
                  },
                ],
                { align: index === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT },
              ),
            ],
            {
              width: cw[index],
              borders: cellBorders({
                left: NO_BORDER,
                right: NO_BORDER,
                top: options.top ?? NO_BORDER,
                bottom: options.bottom ?? NO_BORDER,
              }),
            },
          ),
        ),
      });
    const lines = (quotation.lines ?? []).map((l) =>
      row(
        [l.description ?? "—", `${l.qty ?? ""} ${l.unit ?? ""}`.trim(), money(l.amount)],
        { bottom: line() },
      ),
    );
    body.push(
      table(
        [
          new TableRow({
            children: [
              cell(
                [
                  new Table({
                    width: { size: CONTENT_W - 200, type: WidthType.DXA },
                    columnWidths: cw,
                    borders: BARE,
                    rows: [
                      ...lines,
                      row(["", "Subtotal", money(quotation.subtotal)], { mutedMiddle: true }),
                      row(["", `Tax (${quotation.tax_rate}%)`, money(quotation.tax_amount)], { mutedMiddle: true }),
                      row(["", "Total", money(quotation.total)], {
                        bold: true,
                        size: 10.5,
                        top: line(C.ink, 10),
                        mutedMiddle: false,
                      }),
                    ],
                  }),
                ],
                { width: CONTENT_W },
              ),
            ],
          }),
        ],
        [CONTENT_W],
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
  if (signature) {
    body.push(
      new Paragraph({
        spacing: { before: 60, after: 160 },
        children: [imageRun(signature, 220, 80)],
      }),
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

  /* The footer on every page; no running header. */
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
        footers: { default: footer, first: footer },
        children: body,
      },
    ],
  });

  return Packer.toBlob(doc);
}
