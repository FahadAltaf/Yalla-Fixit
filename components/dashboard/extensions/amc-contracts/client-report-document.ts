import type { ClientReport } from "@/lib/server/amc/client-report";

import { amount, cell, detailsTable, headerCell, t, zebra, type AmcDocumentModel, type Block } from "../amc/amc-document-model";

/*
  The client report (BRD 5.15, DEV-410) as an AMC document: the same
  letterhead, red banner, numbered headings and striped tables as the
  proposal and the contract, built into the shared document model so the
  screen, the PDF and the email attachment are one design.
*/

const day = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "—";
const words = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/* "4 visits", "6 hours", "Unlimited", "Included". */
function included(s: ClientReport["scope"][number]): string {
  if (s.type === "informational") return "Included";
  if (s.included === null) return "Unlimited";
  return `${s.included} ${s.type === "hours" ? (s.included === 1 ? "hour" : "hours") : s.included === 1 ? "visit" : "visits"}`;
}

/** The report's blocks, from its facts. */
export function buildClientReportModel(r: ClientReport): AmcDocumentModel {
  const blocks: Block[] = [];
  const section = (number: string, text: string) => blocks.push({ kind: "heading", number, text });
  const empty = (text: string) => blocks.push({ kind: "paragraph", runs: [t(text, { tone: "muted" })] });

  blocks.push({ kind: "contactStrip" });
  blocks.push({ kind: "banner", text: "AMC SERVICE REPORT" });
  blocks.push(
    detailsTable([
      ["Client", r.contract.customerName || "—"],
      ["Contract", r.contract.number],
      ["Property", r.contract.propertyLabel || "—"],
      ["Contract term", `${day(r.contract.startDate)} to ${day(r.contract.endDate)}`],
      ["Report date", day(r.asOf)],
      ...(r.owner?.name ? ([["Account manager", [r.owner.name, r.owner.phone, r.owner.email].filter(Boolean).join("  ·  ")]] as [string, string][]) : []),
    ]),
  );

  blocks.push({ kind: "paragraph", runs: [t(`Dear ${r.contract.customerName || "client"},`)] });
  if (r.intro.trim()) blocks.push({ kind: "paragraph", runs: [t(r.intro.trim())] });

  /* At a glance: the four figures the email also gives. */
  const doneCount = r.visitsDone.length;
  const toCome = r.visitsRemaining.length;
  blocks.push({
    kind: "table",
    widths: [25, 25, 25, 25],
    header: [headerCell("VISITS COMPLETED", "center"), headerCell("VISITS TO COME", "center"), headerCell("CALL OUTS ATTENDED", "center"), headerCell("ADDITIONAL WORK", "center")],
    rows: [
      [
        cell([[t(String(doneCount), { bold: true })]], { align: "center" }),
        cell([[t(String(toCome), { bold: true })]], { align: "center" }),
        cell([[t(String(r.callOuts.length), { bold: true })]], { align: "center" }),
        cell([[t(String(r.additionalWork.length), { bold: true })]], { align: "center" }),
      ],
    ],
  });

  section("1", "Your plan and allowances");
  if (r.scope.length) {
    blocks.push({
      kind: "table",
      widths: [40, 15, 15, 15, 15],
      header: [headerCell("SERVICE"), headerCell("INCLUDED", "center"), headerCell("USED", "center"), headerCell("BOOKED", "center"), headerCell("REMAINING", "center")],
      rows: zebra(
        r.scope.map((s) => {
          const counted = s.type !== "informational";
          return [
            cell(s.service),
            cell(included(s), { align: "center" }),
            cell(counted ? String(s.used) : "—", { align: "center" }),
            cell(counted && s.booked ? String(s.booked) : "—", { align: "center" }),
            cell([[t(!counted ? "—" : s.remaining === null ? "Unlimited" : String(s.remaining), { bold: true })]], { align: "center" }),
          ];
        }),
      ),
    });
    blocks.push({ kind: "paragraph", runs: [t("Booked: visits already scheduled that will use the allowance.", { tone: "muted" })] });
  } else empty("No services on this contract.");

  section("2", `Visits completed (${doneCount})`);
  if (doneCount) {
    blocks.push({
      kind: "table",
      widths: [12, 18, 70],
      header: [headerCell("VISIT", "center"), headerCell("DATE"), headerCell("SERVICES DONE")],
      rows: zebra(
        r.visitsDone.map((v) => [
          cell(`#${v.visitNo}`, { align: "center" }),
          cell([[t(day(v.date))], ...(v.status === "completed" ? [] : [[t(words(v.status), { tone: "muted" })]])]),
          cell(v.services.length ? v.services.map((s) => [t(s)]) : [[t("—")]], v.photos.length ? { images: v.photos } : {}),
        ]),
      ),
    });
  } else empty("No planned visit completed yet.");

  section("3", `Visits to come (${toCome})`);
  if (toCome) {
    blocks.push({
      kind: "table",
      widths: [12, 88],
      header: [headerCell("VISIT", "center"), headerCell("PLANNED BETWEEN")],
      rows: zebra(r.visitsRemaining.map((v) => [cell(`#${v.visitNo}`, { align: "center" }), cell(`${day(v.windowStart)} and ${day(v.windowEnd)}`)])),
    });
  } else empty(doneCount ? "All planned visits are done." : "No visits are scheduled yet. We will confirm the dates with you.");

  section("4", `Call outs attended (${r.callOuts.length})`);
  if (r.callOuts.length) {
    blocks.push({
      kind: "table",
      widths: [14, 16, 38, 16, 16],
      header: [headerCell("CALL OUT"), headerCell("PRIORITY"), headerCell("ISSUE"), headerCell("ATTENDED"), headerCell("COVERAGE")],
      rows: zebra(
        r.callOuts.map((c) => [
          cell(c.number),
          cell(c.priority === "emergency" ? "Emergency" : "Non-emergency"),
          cell(c.issue),
          cell(day(c.attendedAt)),
          cell([[t(c.covered ? "Covered by AMC" : "Chargeable", { bold: true, tone: c.covered ? "default" : "brand" })]]),
        ]),
      ),
    });
  } else empty("No call outs so far.");

  section("5", "Additional work");
  if (r.additionalWork.length) {
    blocks.push({
      kind: "table",
      widths: [16, 48, 16, 20],
      header: [headerCell("NO."), headerCell("FINDING"), headerCell("STATUS"), headerCell("AED INCL. VAT", "right")],
      rows: zebra(r.additionalWork.map((w) => [cell(w.number), cell(w.finding), cell(words(w.status)), cell(amount(w.total), { align: "right" })])),
    });
    blocks.push({
      kind: "table",
      widths: [60, 40],
      width: 45,
      rows: [[cell([[t("Total", { bold: true })]], { shade: "label" }), cell([[t(`AED ${amount(r.additionalWork.reduce((s, w) => s + w.total, 0))}`, { bold: true })]], { align: "right" })]],
    });
  } else empty("No additional work.");

  if (r.closing.trim()) blocks.push({ kind: "paragraph", runs: [t(r.closing.trim())] });

  return { documentType: "client_report", blocks };
}
