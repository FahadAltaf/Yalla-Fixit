import {
  createContext,
  forwardRef,
  useContext,
  type CSSProperties,
} from "react";
import { Inter } from "next/font/google";

import YallaFixit from "@/public/yalla-fixit.png";
import type { SnaggingQuotation } from "@/modules/snagging";
import type {
  SnaggingChecklistItem,
  SnaggingSnag,
  SnaggingTask,
} from "@/types/types";
import { isVideo } from "./evidence-media";
import CompanyLogo from "@/public/site-logo.webp";

/**
 * Whether this tree is being rasterised for the PDF.
 *
 * A context rather than a prop because the padding fix below is wanted by
 * every small piece of the document -- pills, stat cells, cards, table rows
 * -- and threading a boolean through all of them would be noise.
 */
const PdfMode = createContext(false);

/**
 * Vertical padding, in the two forms this document needs.
 *
 * html2canvas does not place a box's background where the browser does: with
 * symmetric vertical padding the text comes out sitting high in its box,
 * which is what makes the PASS/FAIL pills sit off their rows in the PDF
 * while looking right on screen. The fix is the quotation template's --
 * drop the top padding and carry it all on the bottom.
 *
 * The bottom takes double the authored value rather than the quotation's own
 * numbers, so the box keeps the height it had. Using its literal values (12
 * and 10 both to 15, 5 to 10) was tried and is wrong here: this document's
 * paddings are half the size of a quotation's, so most of them fell outside
 * that table and kept a bottom padding of their own while losing the top --
 * every box got shorter, and the severity badges ended up riding the divider
 * above their row instead of sitting inside it.
 */
function pad(
  forPDF: boolean,
  vertical: number,
  horizontal: number,
): CSSProperties {
  return forPDF
    ? {
      paddingTop: 0,
      paddingBottom: vertical * 2,
      paddingLeft: horizontal,
      paddingRight: horizontal,
    }
    : { padding: `${vertical}px ${horizontal}px` };
}

/**
 * The client-facing snagging report (K1-K3, FR-5.01).
 *
 * A self-contained, print- and PDF-ready A4 document rendered from the
 * inspection data. Every colour is an inline hex rather than a Tailwind
 * token: html2canvas rasterises this node for the PDF and cannot read
 * Tailwind v4's oklch values, so a themed colour would come out black.
 *
 * The layout targets a single A4 page for a standard job (roughly five
 * defects and a 45-item checklist). The checklist is the part most
 * likely to push it over, so it sits in two columns and stays on a
 * tighter line-height than the rest of the document.
 */

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

const FONT = `${inter.style.fontFamily}, "Helvetica Neue", Arial, sans-serif`;
const SCRIPT = `"Brush Script MT", "Segoe Script", "Bradley Hand", cursive`;

/*
  Sampled from the issued handover reports, so a client filing this beside
  one of those does not get two documents from what looks like two firms.
  `orange` rules and footers, `brand` titles, and the four severity fills
  ARE the legend those reports print on their cover.
*/
const C = {
  brand: "#c13d3c",
  deep: "#aa272b",
  orange: "#ff7800",
  ink: "#1a1a2e",
  body: "#1f3864",
  sub: "#6b7280",
  faint: "#9ca3af",
  line: "#ececf0",
  rule: "#111111",
  card: "#f8f8fa",
  /** The one border colour every table and card in the document draws. */
  grid: "#bfbfbf",
} as const;

/**
 * The severity wash behind a defect's description.
 *
 * The grade is the cell's own colour rather than a badge beside it, which
 * is what makes a page of defects scannable: a reader sees how bad the room
 * is before reading a word of it. Matches the cover legend exactly.
 */
const FILL: Record<string, string> = {
  high: "#ffc0c7",
  medium: "#ffe4cc",
  low: "#faf6df",
  ok: "#d7e7b5",
};

/**
 * The unit's number, without the word "Unit" in front of it.
 *
 * Labels are entered both ways — "5101" and "Unit 001" — and the lines
 * that read "Unit: {label}" printed "Unit: Unit 001" for half of them.
 */
function unitNumber(label?: string | null): string {
  if (!label) return "—";
  return label.replace(/^\s*(unit|apt\.?|apartment)\s+/i, "").trim() || label;
}

/** "three" rather than "3", which is how the sentence above reads. */
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "ten",
];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Worst first, wherever defects are listed as an action list. */
const SEVERITY_RANK = ["high", "medium", "low"];

/** A, B, C … for the area sections, as the issued reports letter them. */
function areaLetter(index: number): string {
  let letter = "";
  let n = index;
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

/** Badge palettes. Background and text are always set as a pair. */
const TONE = {
  high: { bg: "#fdecec", fg: "#c81e3a" },
  medium: { bg: "#fff6e6", fg: "#b3720a" },
  low: { bg: "#eaf0fb", fg: "#2255b3" },
  pass: { bg: "#eaf6ee", fg: "#1e8a4c" },
  fail: { bg: "#fdecec", fg: "#c81e3a" },
  neutral: { bg: "#f1f1f4", fg: "#6b7280" },
} as const;

const SEVERITY: Record<string, { label: string; tone: keyof typeof TONE }> = {
  high: { label: "High", tone: "high" },
  medium: { label: "Medium", tone: "medium" },
  low: { label: "Low", tone: "low" },
};

const GST = "Asia/Dubai";

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: GST,
  }).format(new Date(value));
}

function fmtDateTime(value?: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: GST,
  }).format(new Date(value));
}

function visitLabel(task: SnaggingTask): string {
  if (task.visit_type === "additional")
    return `Additional visit · V${task.round_number}`;
  if (task.visit_type === "desnag" || task.round_number > 1)
    return `De-snag round ${task.round_number}`;
  return "Initial inspection";
}

/** A status pill. 7.5px bold on a tinted, rounded ground. */
function Pill({
  tone,
  children,
}: {
  tone: keyof typeof TONE;
  children: React.ReactNode;
}) {
  const forPDF = useContext(PdfMode);
  const t = TONE[tone];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 7.5,
        fontWeight: 700,
        lineHeight: 1.4,
        color: t.fg,
        // background: t.bg,
        borderRadius: 9,
        // ...pad(forPDF, 2, 7),
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        letterSpacing: 0.3,
        // A flex parent stretches its children by default, which turned
        // these into tall vertical blocks beside a multi-line defect.
        // The pill sizes to its own text wherever it is used.
        alignSelf: "flex-start",
        flexShrink: 0,
        height: "fit-content",
        // marginTop: "10px"
      }}
    >
      {children}
    </span>
  );
}

/** One of the five colour-coded figures in the summary row. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE;
}) {
  const forPDF = useContext(PdfMode);
  const t = tone ? TONE[tone] : null;
  return (
    <div
      style={{
        flex: 1,
        // The severity wash the whole document uses, not a second palette.
        background: t ? (FILL[tone as string] ?? t.bg) : "#ffffff",
        border: `1px solid ${C.grid}`,
        ...pad(forPDF, 6, 12),
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 19,
          fontWeight: 800,
          lineHeight: 1.1,
          color: t ? t.fg : C.ink,
          paddingBottom: forPDF ? "10px" : "",

        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 7.5,
          fontWeight: 600,
          color: C.sub,
          marginTop: 3,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const forPDF = useContext(PdfMode);
  return (
    <h2
      /*
        Red heading over an orange hairline, as the issued reports set
        every section. `paddingBottom` carries the whole gap — a symmetric
        pad drops the rule away from the text once html2canvas has it.
      */
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: C.brand,
        margin: "8px 0 5px",
        borderBottom: `1px solid ${C.orange}`,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        paddingBottom: forPDF ? "10px" : "4px",
      }}
    >
      {children}
    </h2>
  );
}

/**
 * One cell of the cover's project table.
 *
 * `paddingBottom` carries the row's height on its own — a symmetric pad
 * puts a filled cell's background above its text once html2canvas has
 * rasterised it, which is what the whole document's `pad()` exists for.
 */
function Cell({
  children,
  label = false,
  strong = false,
  fill,
  colSpan,
}: {
  children: React.ReactNode;
  label?: boolean;
  strong?: boolean;
  fill?: string;
  colSpan?: number;
}) {
  const forPDF = useContext(PdfMode);
  return (
    <td
      colSpan={colSpan}
      style={{
        border: "1px solid #bfbfbf",
        background: fill ?? (label ? "#f2f2f2" : "#ffffff"),
        fontWeight: strong ? 700 : 400,
        color: C.ink,
        verticalAlign: "middle",
        paddingTop: 0,
        paddingBottom: forPDF ? "10px" : "5px",
        paddingLeft: 6,
        paddingRight: 6,
      }}
    >
      {children}
    </td>
  );
}

/** A label/value pair on each side of the cover table. */
function Fact({
  label,
  value,
  label2,
  value2,
}: {
  label: string;
  value: React.ReactNode;
  label2: string;
  value2: React.ReactNode;
}) {
  return (
    <tr>
      <Cell label colSpan={2}>{label}:</Cell>
      <Cell colSpan={2}>{value}</Cell>
      <Cell label colSpan={2}>{label2}:</Cell>
      <Cell colSpan={2}>{value2}</Cell>
    </tr>
  );
}

/**
 * The company lockup: the diamond mark with the name set beside it.
 *
 * `yalla-fixit.png` is the 85x87 diamond ALONE — there is no wordmark asset
 * in the repository — so printing it on its own put a bare symbol where the
 * issued reports carry the full logo. The name is set in type next to it
 * rather than waiting on an asset, which also means it stays sharp at any
 * size instead of being an upscaled bitmap.
 */
function Wordmark({ small = false }: { small?: boolean }) {
  const mark = small ? 26 : 52;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: small ? 6 : 12,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={YallaFixit.src}
        alt="Yalla Fix It"
        style={{ width: mark, height: mark, objectFit: "contain" }}
      />

    </div>
  );
}


function YallaCompanyLogo({ small = false }: { small?: boolean }) {
  // const mark = small ? 26 : 52;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: small ? 6 : 12,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={CompanyLogo.src}
        alt="Yalla Fix It"
        style={{ width: 200, height: 100, objectFit: "contain" }}
      />

    </div>
  );
}

/**
 * The strip every page after the cover opens with.
 *
 * The mark, the document's own name, and the orange rule beneath it —
 * exactly what the issued reports repeat, so a page pulled out of the
 * middle of the document still says what it belongs to.
 *
 * Rendered per page block rather than as a true running header: the PDF is
 * one rasterised canvas sliced into A4, and its paginator draws only a
 * footer. Each block below starts a page, so a head at the top of each
 * lands in the same place a real running header would.
 *
 * PRINT ONLY. On screen the document is one continuous scroll with no page
 * edges, so a header repeating every eight hundred pixels marks nothing —
 * it just interrupts the read with the same line over and over.
 */
function RunningHead({ subject }: { subject: string }) {
  const forPDF = useContext(PdfMode);
  if (!forPDF) return null;
  return (
    <div style={{ paddingTop: 0, paddingBottom: forPDF ? "14px" : "10px" }}>
      <Wordmark small />
      <div
        style={{
          fontSize: 7.5,
          color: C.orange,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          textAlign: "center",
          paddingTop: 0,
          paddingBottom: forPDF ? "8px" : "4px",
        }}
      >
        Property Handover Snagging Report — {subject}
      </div>
      <div style={{ height: 1, background: C.orange }} />
    </div>
  );
}

/** A red section heading, as the issued reports set every one. */
function Heading({ children }: { children: React.ReactNode }) {
  const forPDF = useContext(PdfMode);
  return (
    <div
      style={{
        fontSize: 11,
        color: C.brand,
        paddingTop: 0,
        paddingBottom: forPDF ? "10px" : "6px",
      }}
    >
      {children}
    </div>
  );
}

/**
 * A body paragraph.
 *
 * Bottom padding only, never a margin pair: html2canvas places a block's
 * background off its padding box, and an evenly spaced paragraph prints
 * with its text riding high.
 */
function Para({ children }: { children: React.ReactNode }) {
  const forPDF = useContext(PdfMode);
  return (
    <p
      style={{
        fontSize: 10,
        lineHeight: 1.7,
        color: C.body,
        margin: 0,
        paddingTop: 0,
        paddingBottom: forPDF ? "14px" : "10px",
      }}
    >
      {children}
    </p>
  );
}

/** A bordered, rounded container — the one card shape used throughout. */
function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const forPDF = useContext(PdfMode);
  return (
    <div
      // Read by the PDF paginator (lib/pdf/paginate): a page break is moved
      // up to the top of a card rather than through the middle of one, which
      // is what left page two opening on half a checklist row.
      data-pdf-block
      /*
        Square and hairline-bordered, matching the defect tables and the
        cover's project table. Rounded tinted cards beside a bordered table
        read as two documents stapled together, which is exactly how the
        report looked once the cover went in.
      */
      style={{
        background: "#ffffff",
        border: `1px solid ${C.grid}`,
        ...pad(forPDF, 7, 14),
        ...style,
        ...(forPDF ? { paddingBottom: "5px" } : {}),
      }}
    >
      {children}
    </div>
  );
}

export const InspectionReport = forwardRef<
  HTMLDivElement,
  {
    task: SnaggingTask;
    quotation?: SnaggingQuotation | null;
    generatedAt?: string;
    /**
     * Set only on the tree rendered for the PDF download. The screen and the
     * PDF need different vertical padding (see `pad`), so the two are rendered
     * separately rather than the PDF rasterising the visible node.
     */
    forPDF?: boolean;
  }
>(function InspectionReport(
  { task, quotation, generatedAt, forPDF = false },
  ref,
) {
  const property = task.property;
  const inspector = task.assignees?.find(
    (a) => a.role === "technician",
  )?.user_profile;
  const areas = task.areas ?? [];
  const snags = task.snags ?? [];
  const checklist = task.checklist ?? [];
  const submission = task.submissions?.[0];

  const byArea = new Map<string, SnaggingSnag[]>();
  for (const snag of snags) {
    const key = snag.area?.id ?? snag.area_id ?? "unassigned";
    const list = byArea.get(key) ?? [];
    list.push(snag);
    byArea.set(key, list);
  }

  const high = snags.filter((s) => s.severity === "high").length;
  const medium = snags.filter((s) => s.severity === "medium").length;
  const low = snags.filter((s) => s.severity === "low").length;
  const confirmedAreas = areas.filter((a) => a.confirmed_at).length;
  const accessIssues = areas.filter(
    (a) => a.access_state && a.access_state !== "accessible",
  );
  const checklistDone = checklist.filter(
    (c) => c.status !== "pending" && c.status !== "not_checked",
  ).length;

  /*
    FR-7.02 — the sub-categories this inspection kept failing on.

    Counted from this document's own snags, so the cover and the body can
    never disagree. The v7 catalogue is Category -> Sub-category -> Defect;
    the live rows still carry that middle level as `element_label`, which is
    the same level under its previous name, so this needs no change when the
    rename lands. Area is deliberately not part of the hierarchy.
  */
  const subCategoryTally = (() => {
    const counts = new Map<string, number>();
    for (const snag of snags) {
      const label = snag.element_label?.trim();
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      // Ties broken by label so one inspection always renders the same
      // order: a report that reshuffles between renders is not reproducible.
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 5);
  })();

  /* What the running head names on every page after the cover. */
  const subject = [property?.building_name, property?.unit_label]
    .filter(Boolean)
    .join(", ") || "Inspection";

  /*
    The unit in one sentence, the way the issued reports open.

    Bathrooms and balconies are counted from the areas actually walked
    rather than stored on the property, so the sentence describes the
    inspection rather than the brochure.
  */
  const countAreas = (needle: string) =>
    areas.filter((area) => area.name?.toLowerCase().includes(needle)).length;
  const propertyDescription = [
    property?.bedrooms
      ? `${numberWord(property.bedrooms)}-bedroom ${property.property_type ?? "property"}`
      : (property?.property_type ?? "Property"),
    countAreas("bath") > 0
      ? `with ${numberWord(countAreas("bath"))} bathroom${countAreas("bath") === 1 ? "" : "s"}`
      : null,
    countAreas("balcon") > 0
      ? `and ${numberWord(countAreas("balcon"))} balcony`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  /* Cover facts, derived once so the table stays readable. */
  const apptTime = task.appointment_at
    ? new Date(task.appointment_at).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Dubai",
    })
    : "—";
  const visitTypeLabel =
    task.visit_type === "additional"
      ? "Additional visit"
      : task.visit_type === "desnag"
        ? `De-snag round ${task.round_number}`
        : "Snagging";
  const recordedBy = [
    inspector?.full_name ?? inspector?.email,
    submission?.signed_at ? fmtDate(submission.signed_at) : null,
  ]
    .filter(Boolean)
    .join(" — ");
  /* The unit's plan, used as the cover image where one is on file. */
  const coverPlan = (task.floor_plans ?? []).find((plan) => plan.signed_url);

  const propertyLine = [
    property?.building_name,
    property?.community,
    property?.city,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <PdfMode.Provider value={forPDF}>
      <div
        ref={ref}
        style={{
          width: "794px",
          minHeight: "1123px",
          background: "#ffffff",
          color: C.body,
          fontFamily: FONT,
          fontSize: "10.5px",
          lineHeight: 1.45,
          padding: forPDF ? "0px 24px" : "24px 32px",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {/*
          ── Page 1: the cover, as the issued handover reports set it ──

          A block of its own with a full page's height, so the sheet the
          client opens on is the cover and nothing else: the paginator keeps
          a [data-pdf-block] whole, and the height pushes what follows onto
          page two.
        */}
        <div
          data-pdf-block
          style={{
            position: "relative",
            minHeight: forPDF ? 1020 : 980,
            breakAfter: "page",
            paddingTop: 0,
            paddingBottom: forPDF ? "24px" : "12px",
          }}
        >
          <div style={{ paddingTop: 0, paddingBottom: "16px" }}>
            <YallaCompanyLogo />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: C.brand,
              textTransform: "uppercase",
              paddingBottom: "22px",
            }}
          >
            <span>Property Handover Snagging Report</span>
            <span style={{ paddingRight: 40 }}>Call: 800-Perfect</span>
          </div>

          <div
            style={{
              fontSize: 13,
              color: C.ink,
              paddingBottom: "6px",
            }}
          >
            PROJECT INFORMATION
          </div>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 9,
              color: C.body,
            }}
          >
            <tbody>
              <Fact label="Date of inspection" value={fmtDate(task.scheduled_date)} label2="Client name" value2={property?.client_name ?? "—"} />
              <tr>
                <Cell label>Location:</Cell>
                <Cell strong colSpan={7}>
                  {[property?.building_name, property?.unit_label]
                    .filter(Boolean)
                    .join(" — ") || "—"}
                </Cell>
              </tr>
              <Fact label="Time of inspection" value={apptTime} label2="Client contact number" value2={property?.client_phone ?? "—"} />
              <Fact label="Type of inspection" value={visitTypeLabel} label2="Client email address" value2={property?.client_email ?? "—"} />
              <Fact label="Recorded by/date" value={recordedBy} label2="Package" value2="Handover snagging" />
              <Fact label="Report prepared by/date" value={fmtDate(generatedAt ?? new Date().toISOString())} label2="Property type" value2={property?.property_type ?? "—"} />
              <tr>
                <Cell label colSpan={8}>Legends: (severity grade)</Cell>
              </tr>
              {/* All four grades on one row, the way the cover legend reads. */}
              <tr>
                <Cell label>High:</Cell>
                <Cell fill={FILL.high}>&nbsp;</Cell>
                <Cell label>Medium:</Cell>
                <Cell fill={FILL.medium}>&nbsp;</Cell>
                <Cell label>Low:</Cell>
                <Cell fill={FILL.low}>&nbsp;</Cell>
                <Cell label>Conformity:</Cell>
                <Cell fill={FILL.ok}>&nbsp;</Cell>
              </tr>
            </tbody>
          </table>

          {/* The heavy orange bar that separates the table from the project. */}
          <div style={{ height: 5, background: C.orange, marginTop: 22 }} />

          <div style={{ paddingTop: 0, paddingBottom: "10px", marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
              {[property?.building_name, property?.community]
                .filter(Boolean)
                .join(" — ") || "Property"}
            </div>
            <div style={{ fontSize: 13, color: C.ink, marginTop: 4 }}>
              Unit:{" "}
              <span style={{ color: C.deep, fontWeight: 700 }}>
                {unitNumber(property?.unit_label)}
              </span>
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: C.ink,
                marginTop: 4,
                textTransform: "uppercase",
              }}
            >
              {[
                property?.bedrooms ? `${property.bedrooms}-bedroom` : null,
                property?.property_type ?? "property",
              ]
                .filter(Boolean)
                .join(" ")}
            </div>
          </div>

          {/*
            The unit's own plan, where one is on file. The issued reports
            print a building photograph here; nothing in an inspection
            record holds one, and a defect close-up as the cover image
            would misrepresent the whole document.
          */}
          {coverPlan?.signed_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverPlan.signed_url}
              alt=""
              crossOrigin="anonymous"
              style={{
                display: "block",
                margin: "0 auto",
                maxWidth: "70%",
                maxHeight: 420,
                objectFit: "contain",
              }}
            />
          ) : null}
        </div>

        {/*
          ── Page 2: what the property is, and what a snagging is ──

          The issued reports describe the unit and define the exercise
          before any defect appears, so a client reads the findings already
          knowing what was looked at and what the words mean.
        */}
        <div
          data-pdf-block
          style={{
            minHeight: forPDF ? 1000 : "auto",
            breakAfter: "page",
            paddingTop: 0,
            paddingBottom: forPDF ? "24px" : "12px",
          }}
        >
          <RunningHead subject={subject} />

          <Heading>Property description:</Heading>
          <Para>{propertyDescription}</Para>

          {/* The rooms walked, lettered as the defect sections letter them. */}
          <div style={{ paddingTop: 0, paddingBottom: forPDF ? "18px" : "10px" }}>
            {areas.map((area, index) => (
              <div
                key={area.id}
                style={{
                  fontSize: 10,
                  color: C.ink,
                  paddingLeft: 26,
                  paddingTop: 0,
                  paddingBottom: forPDF ? "10px" : "5px",
                }}
              >
                {areaLetter(index)}.&nbsp;&nbsp;{area.name}
              </div>
            ))}
          </div>

          <Heading>Definition:</Heading>
          <Para>
            Snagging is identifying internal and external defects before the
            developer hands over the property to you. The purpose of a
            snagging is to report any defects of your property to the
            developer prior to formal handover, to record the handover
            condition and/or fix the defects as reported.
          </Para>
          <Para>
            The YFI trained team inspected the property and prepared this
            report with reference pictures, to gauge the overall workmanship
            and the quality of the material used against standard
            construction norms. Where the approved design and technical
            parameters of MEP services are shared prior to inspection, the
            current specification is compared against them. Otherwise the
            visual inspection is based on construction industry standards,
            with no comment on design perspective, assuming the contractor
            follows the design given by the consultant of the project.
          </Para>
        </div>

        {/*
          ── Page 3: the limits of the exercise, and what it found ──
        */}
        <div
          data-pdf-block
          style={{
            minHeight: forPDF ? 1000 : "auto",
            breakAfter: "page",
            paddingTop: 0,
            paddingBottom: forPDF ? "24px" : "12px",
          }}
        >
          <RunningHead subject={subject} />

          <Para>
            The inspection is limited to the parts of the building which are
            visible and/or accessible. YALLA FIX IT have not removed any
            panelling, furniture or floor coverings. External features are
            viewed and inspected from available areas at ground level;
            therefore we are not able to report on any unexposed or
            inaccessible areas of the property to confirm their condition.
          </Para>

          <Heading>Overview:</Heading>
          <Para>
            During the inspection, {propertyDescription.toLowerCase()}{" "}
            <strong>unit number </strong>
            <strong style={{ color: C.deep }}>
              {unitNumber(property?.unit_label)}
            </strong>
            {property?.building_name ? (
              <strong>, {property.building_name}</strong>
            ) : null}{" "}
            was overall found{" "}
            <strong>
              {high > 0
                ? "not yet acceptable, with the comments below"
                : "in acceptable condition with comments,"}
            </strong>{" "}
            below listed:
          </Para>

          <Heading>General remarks:</Heading>
          {/*
            The grades, worst first, each with the rooms it was found in.
            The issued reports write this by hand; the same summary read off
            the record cannot disagree with the defect pages that follow.
          */}
          <div style={{ paddingTop: 0, paddingBottom: forPDF ? "18px" : "10px" }}>
            {(["high", "medium", "low"] as const)
              .map((grade) => ({
                grade,
                items: snags.filter((snag) => snag.severity === grade),
              }))
              .filter((group) => group.items.length > 0)
              .map((group, index) => (
                <div
                  key={group.grade}
                  style={{
                    fontSize: 10,
                    color: C.body,
                    paddingLeft: 26,
                    paddingTop: 0,
                    paddingBottom: forPDF ? "12px" : "6px",
                  }}
                >
                  {index + 1}-&nbsp;&nbsp;
                  <strong>
                    {SEVERITY[group.grade].label} severity — {group.items.length}{" "}
                    defect{group.items.length === 1 ? "" : "s"}
                  </strong>
                  <div style={{ paddingLeft: 18, paddingBottom: "2px" }}>
                    {[
                      ...new Set(
                        group.items.map(
                          (snag) =>
                            snag.area?.name ?? snag.area_label ?? "Unassigned",
                        ),
                      ),
                    ].join(", ")}
                  </div>
                </div>
              ))}
            {snags.length === 0 ? (
              <div style={{ fontSize: 10, color: C.body, paddingLeft: 26 }}>
                No defects were recorded at this inspection.
              </div>
            ) : null}
          </div>
        </div>

        {/*
          The masthead, property/client cards and visit bar that used to
          open the document are gone: the cover page states every one of
          those facts — client, contact, location, inspector, visit type,
          date — in the project table, and printing them twice made the
          first two sheets read as the same page done differently.

          The body picks up from the summary, under its own running head.
        */}
        <RunningHead subject={subject} />

        {/* ── Summary: five colour-coded figures ── */}
        <Heading>Summary</Heading>
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="Total snags" value={String(snags.length)} />
          <Stat
            label="High"
            value={String(high)}
            tone={undefined}
          />
          <Stat
            label="Medium"
            value={String(medium)}
            tone={undefined}
          />
          <Stat
            label="Low"
            value={String(low)}
            tone={undefined}
          />
          <Stat
            label="Areas walked"
            value={`${confirmedAreas}/${areas.length}`}
          />
          <Stat
            label="Checklist"
            value={`${checklistDone}/${checklist.length}`}
          />
        </div>



        {/* ── FR-7.02: what this unit keeps failing on ── */}
        {subCategoryTally.length > 0 ? (
          <div style={{ marginTop: '15px' }}>
            <Heading>Most affected sub-categories</Heading>
            <Card style={pad(forPDF, 6, 14)}>
              {subCategoryTally.map((row, index) => {
                // A bar as well as a number: which one dominates is the
                // point of this block, and that reads faster as a length.
                const share = Math.round(
                  (row.count / Math.max(1, snags.length)) * 100,
                );
                return (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      ...pad(forPDF, 4, 0),
                      borderTop: index === 0 ? "none" : `1px solid ${C.line}`,
                    }}
                  >
                    <span style={{ width: 12, color: C.sub, fontSize: 9 }}>
                      {index + 1}
                    </span>
                    <span
                      style={{ flex: 1, fontWeight: 600, fontSize: 10, color: C.ink }}
                    >
                      {row.label}
                    </span>
                    <span
                      style={{
                        width: 90,
                        height: 6,
                        background: C.line,
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          width: `${Math.max(4, share)}%`,
                          height: 6,
                          background: C.brand,
                        }}
                      />
                    </span>
                    <span
                      style={{
                        width: 26,
                        textAlign: "right",
                        fontWeight: 700,
                        fontSize: 10,
                        color: C.ink,
                      }}
                    >
                      {row.count}
                    </span>
                  </div>
                );
              })}
            </Card>
          </div>
        ) : null}

        {/* ── Areas the inspector could not fully reach ── */}
        {accessIssues.length > 0 ? (
          <div style={{ marginTop: '15px' }}>
            <Heading>Areas not fully inspected</Heading>
            <Card style={pad(forPDF, 6, 14)}>
              {accessIssues.map((area, index) => (
                <div
                  key={area.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    ...pad(forPDF, 5, 0),
                    borderTop: index === 0 ? "none" : `1px solid ${C.line}`,
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>

                    <span style={{ fontWeight: 600, fontSize: 10, color: C.ink }}>
                      {area.name}
                    </span>
                    {area.access_reason ? (
                      <span style={{ color: C.sub, fontSize: 9.5 }}>
                        · {area.access_reason}
                      </span>
                    ) : null}
                  </div>

                  <Pill tone="medium">
                    {area.access_state === "not_accessible"
                      ? "No access"
                      : "Limited"}
                  </Pill>
                </div>
              ))}
            </Card>
          </div>
        ) : null}

        {/* ── Defects, grouped by area, one card per area ── */}
        {/*
          The defect pages open the way the issued reports open theirs:
          the property named once, with the unit picked out, and the area
          sections lettered beneath it.
        */}
        <div
          style={{
            fontSize: 12,
            color: C.ink,
            paddingTop: '20px',
            paddingBottom: forPDF ? "18px" : "10px",
          }}
        >
          {property?.building_name ?? "Property"}, Apartment Number{" "}
          <span style={{ color: C.deep, fontWeight: 700 }}>
            {unitNumber(property?.unit_label)}
          </span>
        </div>

        {areas.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 9.5 }}>No areas recorded.</div>
        ) : (
          (() => {
            /*
              Defects are numbered once, straight through the document.

              The issued reports label every shot `001-A-01`: the running
              number across the whole inspection, the area's letter, and the
              index within that area. A client quoting "number 14" on the
              phone means the same defect whichever page it is on, which a
              per-area count cannot promise.
            */
            let running = 0;
            return areas.map((area, areaIndex) => {
              const areaSnags = byArea.get(area.id) ?? [];
              const letter = areaLetter(areaIndex);
              return (
                <div key={area.id} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: C.ink,
                      ...pad(forPDF, 4, 0),
                    }}
                  >
                    {letter}. {area.name}
                    {areaSnags.length === 0 ? (
                      <span style={{ color: C.sub, fontWeight: 400 }}>
                        {" "}
                        —{" "}
                        {area.access_state === "not_accessible"
                          ? "not inspected"
                          : "no defects found"}
                      </span>
                    ) : null}
                  </div>

                  {areaSnags.map((snag, index) => {
                    running += 1;
                    const photos = (snag.photos ?? []).filter(
                      (p) => p.signed_url,
                    );
                    const cover = photos[0];
                    const grade = SEVERITY[snag.severity] ?? SEVERITY.low;
                    const ref = `${String(running).padStart(3, "0")}-${letter}-${String(
                      index + 1,
                    ).padStart(2, "0")}`;

                    return (
                      <div
                        key={snag.id}
                        style={{
                          display: "flex",
                          alignItems: "stretch",
                          border: `1px solid ${C.grid}`,
                          borderTop: index === 0 ? `1px solid ${C.grid}` : "none",
                          // A defect with no photo keeps a row's height, so a
                          // column of them stays a table rather than a ladder
                          // of different-sized boxes.
                          minHeight: 118,
                          breakInside: "avoid",
                        }}
                      >
                        {/* Evidence, with its reference above it. */}
                        <div
                          style={{
                            width: "55%",
                            borderRight: `1px solid ${C.grid}`,
                            ...pad(forPDF, 4, 6),
                          }}
                        >
                          <div
                            style={{
                              fontSize: 7,
                              fontWeight: 700,
                              color: C.ink,
                              letterSpacing: 0.3,
                              paddingBottom: "4px",
                            }}
                          >
                            {ref}
                          </div>
                          {cover ? (
                            isVideo(cover) ? (
                              <div
                                style={{
                                  width: "72%",
                                  height: 96,
                                  margin: "0 auto",
                                  border: `1px solid ${C.line}`,
                                  background: C.card,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 8,
                                  fontWeight: 600,
                                  color: C.sub,
                                }}
                              >
                                Video evidence
                              </div>
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={cover.signed_url ?? ""}
                                alt=""
                                crossOrigin="anonymous"
                                style={{
                                  width: "72%",
                                  height: 96,
                                  objectFit: "cover",
                                  margin: "0 auto",
                                  display: "block",
                                }}
                              />
                            )
                          ) : (
                            <div
                              style={{
                                fontSize: 8,
                                color: C.faint,
                                paddingBottom: "6px",
                              }}
                            >
                              No photo recorded.
                            </div>
                          )}
                        </div>

                        {/*
                          The description, washed in its own severity.

                          `paddingBottom` alone, never a symmetric vertical
                          pad: html2canvas puts a filled box's background
                          where the padding is not, so an evenly padded cell
                          prints with its tint riding above the text.
                        */}
                        <div
                          style={{
                            width: "45%",
                            background: FILL[grade.tone] ?? FILL.low,
                            fontSize: 9.5,
                            color: C.body,
                            lineHeight: 1.45,
                            ...pad(forPDF, 5, 8),
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{running}-</span>{" "}
                          {[snag.element_label, snag.defect_label]
                            .filter(Boolean)
                            .join(" · ") || "Defect"}
                          {snag.note ? (
                            <div
                              style={{
                                marginTop: 4,
                                color: C.body,
                                paddingBottom: "2px",
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>Comment: </span>
                              {snag.note}
                            </div>
                          ) : null}
                          {snag.status === "verified_poor_quality" ||
                            snag.status === "verified_not_done" ? (
                            <div
                              style={{
                                marginTop: 3,
                                fontWeight: 600,
                                color: C.deep,
                                paddingBottom: "2px",
                              }}
                            >
                              {snag.status === "verified_not_done"
                                ? "Re-inspected: not done"
                                : "Re-inspected: poor quality fix"}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()
        )}

        {/* ── Checklist, two columns by category ── */}
        {checklist.length > 0 ? (
          <>
            <Heading>Inspection checklist</Heading>
            <ChecklistBlock items={checklist} />
          </>
        ) : null}

        {/* ── Commercial summary ── */}
        {quotation ? (
          <>
            <Heading>Commercial summary</Heading>
            <Card style={{ ...pad(forPDF, 8, 14), breakInside: "avoid" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 9.5,
                }}
              >
                <tbody>
                  {quotation.lines.map((line, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                      <td style={{ ...pad(forPDF, 4, 0) }}>
                        {line.description}
                      </td>
                      <td
                        style={{
                          ...pad(forPDF, 4, 0),
                          textAlign: "right",
                          color: C.sub,
                        }}
                      >
                        {line.qty} {line.unit}
                      </td>
                      <td
                        style={{
                          ...pad(forPDF, 4, 0),
                          textAlign: "right",
                          fontWeight: 600,
                        }}
                      >
                        {quotation.currency} {line.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td
                      style={{
                        ...pad(forPDF, 4, 0),
                        textAlign: "right",
                        color: C.sub,
                      }}
                      colSpan={2}
                    >
                      Subtotal
                    </td>
                    <td style={{ ...pad(forPDF, 4, 0), textAlign: "right" }}>
                      {quotation.currency} {quotation.subtotal.toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        ...pad(forPDF, 4, 0),
                        textAlign: "right",
                        color: C.sub,
                      }}
                      colSpan={2}
                    >
                      Tax ({quotation.tax_rate}%)
                    </td>
                    <td style={{ ...pad(forPDF, 4, 0), textAlign: "right" }}>
                      {quotation.currency}{" "}
                      {quotation.tax_amount.toLocaleString()}
                    </td>
                  </tr>
                  <tr style={{ borderTop: `1.5px solid ${C.ink}` }}>
                    <td
                      style={{
                        ...pad(forPDF, 6, 0),
                        textAlign: "right",
                        fontWeight: 800,
                        fontSize: 10.5,
                      }}
                      colSpan={2}
                    >
                      Total
                    </td>
                    <td
                      style={{
                        ...pad(forPDF, 6, 0),
                        textAlign: "right",
                        fontWeight: 800,
                        fontSize: 10.5,
                      }}
                    >
                      {quotation.currency} {quotation.total.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </>
        ) : null}

        {/*
          ── Outlines: the report's closing page ──

          The issued reports end on a plain-language summary and the
          company stamp, not on a signature grid. The grid is gone: an
          inspection report is issued BY Yalla Fix It, and asking the
          client to counter-sign the findings inside the document was
          never what the handover reports do.
        */}
        <div
          data-pdf-block
          style={{
            breakBefore: "page",
            paddingTop: 0,
            paddingBottom: forPDF ? "24px" : "12px",
          }}
        >
          <RunningHead subject={subject} />

          <Heading>Outlines:</Heading>
          <Para>
            {snags.length === 0 ? (
              <>
                The property was found in acceptable condition, with no
                defects recorded at this inspection.
              </>
            ) : (
              <>
                The property was found in{" "}
                {high > 0
                  ? "acceptable condition with comments"
                  : "acceptable condition"}
                , with {snags.length} finishing and workmanship comment
                {snags.length === 1 ? "" : "s"}, highlighted below.
              </>
            )}
          </Para>

          {/*
            The defects themselves, worst first — the client's action list.
            Read off the record rather than typed, so it cannot drift from
            the pages above it.
          */}
          <div style={{ paddingTop: 0, paddingBottom: forPDF ? "18px" : "10px" }}>
            {[...snags]
              .sort(
                (a, b) =>
                  SEVERITY_RANK.indexOf(a.severity) -
                  SEVERITY_RANK.indexOf(b.severity),
              )
              .map((snag) => (
                <div
                  key={snag.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    fontSize: 10,
                    lineHeight: 1.6,
                    color: C.body,
                    paddingLeft: 20,
                    paddingTop: 0,
                    paddingBottom: forPDF ? "10px" : "5px",
                  }}
                >
                  <span aria-hidden>-</span>
                  <span>
                    {[
                      snag.area?.name ?? snag.area_label,
                      snag.element_label,
                      snag.defect_label,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {snag.note ? (
                      <span style={{ color: C.sub }}> — {snag.note}</span>
                    ) : null}
                  </span>
                </div>
              ))}
          </div>

          {/* Who inspected it, and when it was signed off internally. */}
          <div
            style={{
              fontSize: 9.5,
              color: C.body,
              paddingTop: 0,
              paddingBottom: forPDF ? "14px" : "8px",
            }}
          >
            Inspected by{" "}
            <strong>{inspector?.full_name ?? inspector?.email ?? "—"}</strong>
            {submission?.signed_at ? (
              <> · signed off {fmtDate(submission.signed_at)}</>
            ) : null}
          </div>

          {submission?.signature_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={submission.signature_url}
              alt=""
              crossOrigin="anonymous"
              style={{
                display: "block",
                maxHeight: 120,
                maxWidth: 240,
                objectFit: "contain",
              }}
            />
          ) : null}
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 7.5,
            lineHeight: 1.4,
            color: C.faint,
            textAlign: "center",
          }}
        >
          This report records the condition observed at the time of inspection.
          Defects are classified by severity for prioritisation and do not
          constitute a structural or legal certification. Yalla Fixit Property
          Care.
        </div>

        {/*
          The contact strip every issued report closes on: an orange rule,
          the company line centred beneath it. Bottom padding only — a
          symmetric pad here prints the rule sitting on the text.
        */}
        <div
          style={{
            borderTop: `1px solid ${C.orange}`,
            marginTop: 10,
            textAlign: "center",
            fontSize: 7,
            letterSpacing: 0.3,
            color: C.orange,
            paddingTop: 0,
            paddingBottom: forPDF ? "12px" : "6px",
          }}
        >
          YALLA FIX IT, PO BOX 550312 | TEL 800 - PERFECT |
          INFO@YALLAFIXIT.AE | WWW.YALLAFIXIT.AE
        </div>
      </div>
    </PdfMode.Provider>
  );
});

/**
 * The checklist, grouped by category across two columns.
 *
 * Two columns roughly halves the height this section takes, which is
 * what keeps a 45-item list on page one. Line-height is deliberately
 * tighter here than in the rest of the document for the same reason.
 */
function ChecklistBlock({ items }: { items: SnaggingChecklistItem[] }) {
  const forPDF = useContext(PdfMode);
  const groups = new Map<string, SnaggingChecklistItem[]>();
  for (const item of items) {
    const list = groups.get(item.group_name) ?? [];
    list.push(item);
    groups.set(item.group_name, list);
  }

  const mark: Record<string, { label: string; tone: keyof typeof TONE }> = {
    passed: { label: "Pass", tone: "pass" },
    failed: { label: "Fail", tone: "fail" },
    not_checked: { label: "N/C", tone: "medium" },
    pending: { label: "—", tone: "neutral" },
  };

  /*
   * Columns are built here rather than with CSS multi-column.
   *
   * html2canvas rasterises this document for the PDF and does not
   * implement CSS columns: it painted the category cards as empty boxes
   * and dropped every label inside them. The on-screen version looked
   * right, which is exactly why this had to be checked against a
   * generated PDF rather than the preview.
   *
   * Splitting the categories into explicit flex columns gives the same
   * layout out of primitives html2canvas does support.
   */
  // Largest category first, then each one into whichever column is
  // currently shortest. Assigning in definition order left the last column
  // finishing a third of a page above the others; taking the big ones while
  // there is still room to place them is what evens the three out.
  const entries = Array.from(groups).sort((a, b) => b[1].length - a[1].length);
  const columnCount = entries.length > 6 ? 3 : 2;
  const columns: Array<Array<[string, SnaggingChecklistItem[]]>> = Array.from(
    { length: columnCount },
    () => [],
  );
  // Balance on item count, plus a constant for each card's own header
  // and padding, so the columns finish at roughly the same height.
  const load = new Array<number>(columnCount).fill(0);
  for (const entry of entries) {
    let target = 0;
    for (let i = 1; i < columnCount; i++)
      if (load[i] < load[target]) target = i;
    columns[target].push(entry);
    load[target] += entry[1].length + 2;
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      {columns.map((column, columnIndex) => (
        <div key={columnIndex} style={{ flex: 1, minWidth: 0 }}>
          {column.map(([group, groupItems]) => (
            <div
              key={group}
              // breakInside is honoured by the browser's own print, but the
              // PDF is a rasterised canvas and html2canvas drops it -- this
              // is the attribute the paginator actually reads.
              data-pdf-block
              // Square and hairline, like every other block in the report.
              style={{
                background: "#ffffff",
                border: `1px solid ${C.grid}`,
                ...pad(forPDF, 6, 10),
                marginBottom: 6,
                breakInside: "avoid",
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: C.brand,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  marginBottom: 3,
                }}
              >
                {group}
              </div>
              {groupItems.map((item, index) => {
                const m = mark[item.status] ?? mark.pending;
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      ...pad(forPDF, 0.5, 0),
                      // borderTop: index === 0 ? "none" : `1px solid ${C.line}`,
                      lineHeight: 1.2,
                    }}
                  >
                    <span style={{ fontSize: 9, color: C.body }}>
                      {item.label}
                    </span>
                    <Pill tone={m.tone}>{m.label}</Pill>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
