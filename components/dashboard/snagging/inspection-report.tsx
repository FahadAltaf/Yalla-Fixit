import {
  createContext,
  forwardRef,
  useContext,
  type CSSProperties,
} from "react";
import { Inter } from "next/font/google";

import yallaFixit from "@/public/yalla-fixit.png";
import type { SnaggingQuotation } from "@/modules/snagging";
import type {
  SnaggingChecklistItem,
  SnaggingSnag,
  SnaggingTask,
} from "@/types/types";
import { isVideo } from "./evidence-media";

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

const C = {
  brand: "#b0243c",
  ink: "#1a1a2e",
  body: "#333344",
  sub: "#6b7280",
  faint: "#9ca3af",
  line: "#ececf0",
  card: "#f8f8fa",
} as const;

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
        background: t ? t.bg : C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
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
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: C.ink,
        margin: "6px 0 5px",
        borderBottom: `1.5px solid ${C.brand}`,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        paddingBottom: forPDF ? "10px" : "4px",
      }}
    >
      {children}
    </h2>
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
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
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
        {/* ── Header: same mark and company block as the quotation ── */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            paddingBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={yallaFixit.src}
              alt="Yalla Fixit"
              style={{
                width: 50,
                height: 50,
                objectFit: "contain",
                objectPosition: "left",
                // ...(forPDF ? { marginBottom: "5px" } : {}),
              }}
            />
            <div style={{ marginTop: forPDF ? "-5px" : "" }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: C.ink,
                  letterSpacing: -0.3,
                }}
              >
                Yalla Fix It
              </div>
              <div
                style={{
                  fontSize: 8,
                  color: C.sub,
                  lineHeight: 1.5,
                  marginTop: 2,
                }}
              >
                Office 102, Building 6, Gold &amp; Diamond Park, Dubai
                <br />
                https://www.yallafixit.ae
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: C.brand,
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              Snagging Inspection Report
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: C.ink,
                marginTop: 4,
              }}
            >
              {task.code}
            </div>
            <div style={{ fontSize: 7.5, color: C.faint, marginTop: 2 }}>
              {fmtDate(generatedAt ?? new Date().toISOString())}
            </div>
          </div>
        </div>
        <div
          style={{
            height: 2,
            background: C.brand,
            borderRadius: 2,
            margin: "6px 0 8px",
          }}
        />

        {/* ── Property + client, as two cards ── */}
        <div style={{ display: "flex", gap: 10 }}>
          <Card style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 7.5,
                fontWeight: 600,
                color: C.sub,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Property
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.ink,
                marginTop: 3,
              }}
            >
              {property?.unit_label || task.code}
            </div>
            <div style={{ fontSize: 9.5, color: C.sub, marginTop: 2 }}>
              {propertyLine || "—"}
            </div>
            <div style={{ fontSize: 9.5, color: C.sub }}>
              {[property?.property_type, property?.developer_name]
                .filter(Boolean)
                .join(" · ") || "—"}
            </div>
          </Card>
          <Card style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 7.5,
                fontWeight: 600,
                color: C.sub,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Client
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.ink,
                marginTop: 3,
              }}
            >
              {property?.client_name || "—"}
            </div>
            <div style={{ fontSize: 9.5, color: C.sub, marginTop: 2 }}>
              {property?.client_email || ""}
            </div>
            <div style={{ fontSize: 9.5, color: C.sub }}>
              {property?.client_phone || ""}
            </div>
          </Card>
        </div>

        {/* Visit strip — dark so it separates the two card rows. */}
        <div
          style={{
            display: "flex",
            gap: 18,
            background: C.ink,
            borderRadius: 8,
            ...pad(forPDF, 5, 14),
            marginTop: 6,
            fontSize: 9,
            color: "#ffffff",
          }}
        >
          <span style={{ flex: 1 }}>
            <span style={{ color: "#a5a5b8" }}>Visit: </span>
            <span style={{ fontWeight: 600 }}>{visitLabel(task)}</span>
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ color: "#a5a5b8" }}>Inspected: </span>
            <span style={{ fontWeight: 600 }}>
              {fmtDate(task.scheduled_date ?? submission?.signed_at)}
            </span>
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ color: "#a5a5b8" }}>Inspector: </span>
            <span style={{ fontWeight: 600 }}>
              {inspector?.full_name || "—"}
            </span>
          </span>
        </div>

        {/* ── Summary: five colour-coded figures ── */}
        <SectionTitle>Summary</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="Total snags" value={String(snags.length)} />
          <Stat
            label="High"
            value={String(high)}
            tone={high > 0 ? "high" : undefined}
          />
          <Stat
            label="Medium"
            value={String(medium)}
            tone={medium > 0 ? "medium" : undefined}
          />
          <Stat
            label="Low"
            value={String(low)}
            tone={low > 0 ? "low" : undefined}
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

        {/* ── Areas the inspector could not fully reach ── */}
        {accessIssues.length > 0 ? (
          <>
            <SectionTitle>Areas not fully inspected</SectionTitle>
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
                        — {area.access_reason}
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
          </>
        ) : null}

        {/* ── Defects, grouped by area, one card per area ── */}
        <SectionTitle>Defects by area</SectionTitle>
        {areas.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 9.5 }}>No areas recorded.</div>
        ) : (
          areas.map((area) => {
            const areaSnags = byArea.get(area.id) ?? [];
            return (
              <Card
                key={area.id}
                style={{
                  padding: 0,
                  marginBottom: 5,
                  breakInside: "avoid",
                  background: "#ffffff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: C.card,
                    borderBottom:
                      areaSnags.length > 0 ? `1px solid ${C.line}` : "none",
                    borderRadius: areaSnags.length > 0 ? "8px 8px 0 0" : 8,
                    ...pad(forPDF, 6, 14),
                  }}
                >
                  <span
                    style={{ fontWeight: 700, fontSize: 10.5, color: C.ink }}
                  >
                    {area.name}
                  </span>
                  <span style={{ fontSize: 8, color: C.sub }}>
                    {areaSnags.length === 0
                      ? area.access_state === "not_accessible"
                        ? "Not inspected"
                        : "No defects found"
                      : `${areaSnags.length} defect${areaSnags.length === 1 ? "" : "s"}`}
                  </span>
                </div>

                {areaSnags.map((snag, index) => {
                  const photos = (snag.photos ?? []).filter(
                    (p) => p.signed_url,
                  );
                  return (
                    <div
                      key={snag.id}
                      style={{
                        ...pad(forPDF, 6, 14),
                        borderTop: index === 0 ? "none" : `1px solid ${C.line}`,
                        breakInside: "avoid",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: 10,
                              color: C.ink,
                            }}
                          >
                            {[snag.element_label, snag.defect_label]
                              .filter(Boolean)
                              .join(" · ") || "Defect"}
                          </span>
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 7.5,
                              color: C.faint,
                              marginLeft: 6,
                            }}
                          >
                            {snag.snag_code}
                          </span>
                          {snag.note ? (
                            <div
                              style={{
                                color: C.sub,
                                fontSize: 9.5,
                                marginTop: 1,
                              }}
                            >
                              {snag.note}
                            </div>
                          ) : null}
                          {photos[0]?.taken_at ? (
                            <div
                              style={{
                                fontSize: 7.5,
                                color: C.faint,
                                marginTop: 2,
                                paddingBottom: "4px",
                              }}
                            >
                              Captured {fmtDateTime(photos[0].taken_at)}
                            </div>
                          ) : null}
                        </div>
                        <Pill
                          tone={(SEVERITY[snag.severity] ?? SEVERITY.low).tone}
                        >
                          {(SEVERITY[snag.severity] ?? SEVERITY.low).label}
                        </Pill>
                      </div>

                      {photos.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            gap: 5,
                            marginTop: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          {photos.slice(0, 6).map((photo) =>
                            /*
                            A printed report cannot play a clip, and an
                            <img> pointed at an mp4 renders as a broken
                            tile — which read to the client as missing
                            evidence rather than as evidence they need to
                            open the portal for. A labelled tile says the
                            footage exists and where it lives.
                          */
                            isVideo(photo) ? (
                              <div
                                key={photo.id}
                                style={{
                                  width: 46,
                                  height: 46,
                                  borderRadius: 6,
                                  border: `1px solid ${C.line}`,
                                  background: C.card,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 7,
                                  fontWeight: 600,
                                  color: C.sub,
                                  textAlign: "center",
                                  lineHeight: 1.2,
                                }}
                              >
                                Video
                              </div>
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={photo.id}
                                src={photo.signed_url ?? ""}
                                alt=""
                                crossOrigin="anonymous"
                                style={{
                                  width: 46,
                                  height: 46,
                                  objectFit: "cover",
                                  borderRadius: 6,
                                  border: `1px solid ${C.line}`,
                                  display: "block",
                                }}
                              />
                            ),
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </Card>
            );
          })
        )}

        {/* ── Checklist, two columns by category ── */}
        {checklist.length > 0 ? (
          <>
            <SectionTitle>Inspection checklist</SectionTitle>
            <ChecklistBlock items={checklist} />
          </>
        ) : null}

        {/* ── Commercial summary ── */}
        {quotation ? (
          <>
            <SectionTitle>Commercial summary</SectionTitle>
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

        {/* ── Sign-off, and the disclaimer directly beneath it ── */}
        <SectionTitle>Sign-off</SectionTitle>
        <Card style={{ breakInside: "avoid" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 20,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 7.5,
                  fontWeight: 600,
                  color: C.sub,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Signed by
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: C.ink,
                  marginTop: 3,
                }}
              >
                {submission?.signer_name || "—"}
              </div>
              <div style={{ fontSize: 8, color: C.faint, marginTop: 1 }}>
                {submission?.signed_at
                  ? fmtDate(submission.signed_at)
                  : "Not yet signed off"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {submission?.signature_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={submission.signature_url}
                  alt="Signature"
                  crossOrigin="anonymous"
                  style={{ maxHeight: 46, maxWidth: 200, objectFit: "contain" }}
                />
              ) : submission?.signer_name ? (
                <span
                  style={{ fontFamily: SCRIPT, fontSize: 22, color: C.ink }}
                >
                  {submission.signer_name}
                </span>
              ) : null}
              <div
                style={{
                  borderTop: `1px solid ${C.line}`,
                  marginTop: 3,
                  paddingTop: 2,
                  fontSize: 7.5,
                  color: C.faint,
                }}
              >
                Client signature
              </div>
            </div>
          </div>
        </Card>

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
              style={{
                background: C.card,
                border: `1px solid ${C.line}`,
                borderRadius: 8,
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
