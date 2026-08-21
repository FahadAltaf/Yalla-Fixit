import { forwardRef } from "react";

import type { SnaggingQuotation } from "@/modules/snagging";
import type { SnaggingChecklistItem, SnaggingSnag, SnaggingTask } from "@/types/types";

/**
 * The client-facing snagging report (K1-K3, FR-5.01).
 *
 * A self-contained, print- and PDF-ready document rendered from the
 * inspection data. It deliberately uses inline hex colours rather than
 * Tailwind theme tokens: html2canvas (which rasterises this node for the
 * PDF) cannot read Tailwind v4's oklch colours, so the report would come
 * out black if it leaned on them.
 */

const C = {
  ink: "#1f2937",
  sub: "#6b7280",
  line: "#e5e7eb",
  soft: "#f9fafb",
  brand: "#0f766e",
  brandSoft: "#f0fdfa",
  high: "#dc2626",
  medium: "#d97706",
  low: "#2563eb",
  ok: "#16a34a",
  warn: "#b45309",
} as const;

const SEVERITY: Record<string, { label: string; color: string; tint: string }> = {
  high: { label: "High", color: C.high, tint: "#fef2f2" },
  medium: { label: "Medium", color: C.medium, tint: "#fffbeb" },
  low: { label: "Low", color: C.low, tint: "#eff6ff" },
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

function visitLabel(task: SnaggingTask): string {
  if (task.visit_type === "additional") return `Additional visit · V${task.round_number}`;
  if (task.visit_type === "desnag" || task.round_number > 1)
    return `De-snag round ${task.round_number}`;
  return "Initial inspection";
}

function SeverityTag({ severity }: { severity: string }) {
  const s = SEVERITY[severity] ?? SEVERITY.low;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        color: s.color,
        background: s.tint,
        border: `1px solid ${s.color}33`,
        borderRadius: 4,
        padding: "1px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ flex: 1, padding: "12px 14px", borderRight: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone ?? C.ink, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 14,
        fontWeight: 800,
        color: C.ink,
        margin: "26px 0 10px",
        paddingBottom: 6,
        borderBottom: `2px solid ${C.brand}`,
        textTransform: "uppercase",
        letterSpacing: 0.6,
      }}
    >
      {children}
    </h2>
  );
}

export const InspectionReport = forwardRef<HTMLDivElement, {
  task: SnaggingTask;
  quotation?: SnaggingQuotation | null;
  generatedAt?: string;
}>(function InspectionReport({ task, quotation, generatedAt }, ref) {
  const property = task.property;
  const inspector = task.assignees?.find((a) => a.role === "technician")?.user_profile;
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
  const accessIssues = areas.filter((a) => a.access_state && a.access_state !== "accessible");
  const checklistDone = checklist.filter((c) => c.status !== "pending" && c.status !== "not_checked").length;

  const propertyLine = [property?.unit_label, property?.building_name, property?.community]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      ref={ref}
      style={{
        width: 794,
        background: "#ffffff",
        color: C.ink,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 12.5,
        lineHeight: 1.5,
        padding: 36,
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: C.brand }}>
            YALLA FIXIT
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>Property Care · Snagging</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Snagging Inspection Report</div>
          <div style={{ fontSize: 12, fontFamily: "monospace", color: C.sub, marginTop: 2 }}>
            {task.code}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>
            Generated {fmtDate(generatedAt ?? new Date().toISOString())}
          </div>
        </div>
      </div>
      <div style={{ height: 3, background: C.brand, borderRadius: 2, margin: "14px 0 4px" }} />

      {/* Property + client */}
      <div style={{ display: "flex", gap: 16, marginTop: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.sub, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Property
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
            {property?.unit_label || task.code}
          </div>
          <div style={{ color: C.sub, marginTop: 2 }}>{propertyLine || "—"}</div>
          <div style={{ color: C.sub, marginTop: 2 }}>
            {[property?.property_type, property?.developer_name].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.sub, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Client
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
            {property?.client_name || "—"}
          </div>
          <div style={{ color: C.sub, marginTop: 2 }}>{property?.client_email || ""}</div>
          <div style={{ color: C.sub, marginTop: 2 }}>{property?.client_phone || ""}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 12 }}>
        <div style={{ flex: 1 }}>
          <span style={{ color: C.sub }}>Visit: </span>
          <span style={{ fontWeight: 700 }}>{visitLabel(task)}</span>
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ color: C.sub }}>Inspected: </span>
          <span style={{ fontWeight: 700 }}>{fmtDate(task.scheduled_date ?? submission?.signed_at)}</span>
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ color: C.sub }}>Inspector: </span>
          <span style={{ fontWeight: 700 }}>{inspector?.full_name || "—"}</span>
        </div>
      </div>

      {/* Summary */}
      <SectionTitle>Summary</SectionTitle>
      <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden" }}>
        <SummaryStat label="Total snags" value={String(snags.length)} />
        <SummaryStat label="High" value={String(high)} tone={high > 0 ? C.high : undefined} />
        <SummaryStat label="Medium" value={String(medium)} tone={medium > 0 ? C.medium : undefined} />
        <SummaryStat label="Areas walked" value={`${confirmedAreas}/${areas.length}`} />
        <div style={{ flex: 1, padding: "12px 14px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
            {checklistDone}/{checklist.length}
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Checklist
          </div>
        </div>
      </div>
      {low > 0 ? (
        <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>
          Includes {low} low-severity item{low === 1 ? "" : "s"}.
        </div>
      ) : null}

      {/* Access issues */}
      {accessIssues.length > 0 ? (
        <>
          <SectionTitle>Areas not fully inspected</SectionTitle>
          {accessIssues.map((area) => (
            <div
              key={area.id}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "8px 0",
                borderBottom: `1px solid ${C.line}`,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.warn,
                  background: "#fffbeb",
                  border: `1px solid ${C.warn}33`,
                  borderRadius: 4,
                  padding: "1px 7px",
                  whiteSpace: "nowrap",
                }}
              >
                {area.access_state === "not_accessible" ? "No access" : "Limited"}
              </span>
              <div>
                <div style={{ fontWeight: 700 }}>{area.name}</div>
                {area.access_reason ? (
                  <div style={{ color: C.sub, fontSize: 12 }}>{area.access_reason}</div>
                ) : null}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {/* Defects by area */}
      <SectionTitle>Defects by area</SectionTitle>
      {areas.length === 0 ? (
        <div style={{ color: C.sub }}>No areas recorded.</div>
      ) : (
        areas.map((area) => {
          const areaSnags = byArea.get(area.id) ?? [];
          return (
            <div key={area.id} style={{ marginBottom: 14, breakInside: "avoid" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: C.soft,
                  border: `1px solid ${C.line}`,
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
              >
                <span style={{ fontWeight: 800 }}>{area.name}</span>
                <span style={{ fontSize: 11, color: C.sub }}>
                  {areaSnags.length === 0
                    ? area.access_state === "not_accessible"
                      ? "Not inspected"
                      : "No defects found"
                    : `${areaSnags.length} defect${areaSnags.length === 1 ? "" : "s"}`}
                </span>
              </div>

              {areaSnags.map((snag) => {
                const photos = (snag.photos ?? []).filter((p) => p.signed_url);
                return (
                  <div
                    key={snag.id}
                    style={{ padding: "8px 10px", borderBottom: `1px solid ${C.line}`, breakInside: "avoid" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 700 }}>
                          {[snag.element_label, snag.defect_label].filter(Boolean).join(" · ") ||
                            "Defect"}
                        </span>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: C.sub, marginLeft: 8 }}>
                          {snag.snag_code}
                        </span>
                        {snag.note ? (
                          <div style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>{snag.note}</div>
                        ) : null}
                      </div>
                      <SeverityTag severity={snag.severity} />
                    </div>

                    {photos.length > 0 ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        {photos.slice(0, 4).map((photo) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={photo.id}
                            src={photo.signed_url ?? ""}
                            alt=""
                            crossOrigin="anonymous"
                            style={{
                              width: 92,
                              height: 92,
                              objectFit: "cover",
                              borderRadius: 6,
                              border: `1px solid ${C.line}`,
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {/* Checklist */}
      {checklist.length > 0 ? (
        <>
          <SectionTitle>Inspection checklist</SectionTitle>
          <ChecklistBlock items={checklist} />
        </>
      ) : null}

      {/* Commercial summary */}
      {quotation ? (
        <>
          <SectionTitle>Commercial summary</SectionTitle>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {quotation.lines.map((line, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <td style={{ padding: "6px 0" }}>{line.description}</td>
                  <td style={{ padding: "6px 0", textAlign: "right", color: C.sub }}>
                    {line.qty} {line.unit}
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 600 }}>
                    {quotation.currency} {line.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: "6px 0", textAlign: "right", color: C.sub }} colSpan={2}>
                  Subtotal
                </td>
                <td style={{ padding: "6px 0", textAlign: "right" }}>
                  {quotation.currency} {quotation.subtotal.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "6px 0", textAlign: "right", color: C.sub }} colSpan={2}>
                  Tax ({quotation.tax_rate}%)
                </td>
                <td style={{ padding: "6px 0", textAlign: "right" }}>
                  {quotation.currency} {quotation.tax_amount.toLocaleString()}
                </td>
              </tr>
              <tr style={{ borderTop: `2px solid ${C.ink}` }}>
                <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 800 }} colSpan={2}>
                  Total
                </td>
                <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 800 }}>
                  {quotation.currency} {quotation.total.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      {/* Sign-off */}
      <SectionTitle>Sign-off</SectionTitle>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: C.sub, fontSize: 12 }}>Signed by</div>
          <div style={{ fontWeight: 700 }}>{submission?.signer_name || "—"}</div>
          <div style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>
            {submission?.signed_at ? fmtDate(submission.signed_at) : "Not yet signed off"}
          </div>
        </div>
        <div style={{ flex: 1, textAlign: "right" }}>
          {submission?.signature_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={submission.signature_url}
              alt="Signature"
              crossOrigin="anonymous"
              style={{ maxHeight: 64, maxWidth: 240, objectFit: "contain" }}
            />
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 28, paddingTop: 12, borderTop: `1px solid ${C.line}`, fontSize: 10.5, color: C.sub }}>
        This report records the condition observed at the time of inspection. Defects are classified by
        severity for prioritisation and do not constitute a structural or legal certification. Yalla Fixit
        Property Care.
      </div>
    </div>
  );
});

/** Checklist grouped by its group name, with a result mark per item. */
function ChecklistBlock({ items }: { items: SnaggingChecklistItem[] }) {
  const groups = new Map<string, SnaggingChecklistItem[]>();
  for (const item of items) {
    const list = groups.get(item.group_name) ?? [];
    list.push(item);
    groups.set(item.group_name, list);
  }
  const mark: Record<string, { label: string; color: string }> = {
    passed: { label: "Pass", color: C.ok },
    failed: { label: "Fail", color: C.high },
    not_checked: { label: "Not checked", color: C.warn },
    pending: { label: "—", color: C.sub },
  };

  return (
    <div>
      {Array.from(groups, ([group, groupItems]) => (
        <div key={group} style={{ marginBottom: 8, breakInside: "avoid" }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: C.sub, margin: "6px 0 2px" }}>{group}</div>
          {groupItems.map((item) => {
            const m = mark[item.status] ?? mark.pending;
            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "3px 0",
                  borderBottom: `1px solid ${C.soft}`,
                }}
              >
                <span>{item.label}</span>
                <span style={{ color: m.color, fontWeight: 700, whiteSpace: "nowrap" }}>{m.label}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
