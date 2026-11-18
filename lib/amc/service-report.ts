import {
  cell,
  detailsTable,
  headerCell,
  t,
  zebra,
  type AmcDocumentModel,
  type Block,
} from "@/components/dashboard/extensions/amc/amc-document-model";

/*
  The service report of a planned visit, a call out or an additional work
  (18 Nov 2026), as an AMC document: the same letterhead, red banner,
  numbered headings and striped tables as the proposal, the contract and the
  client report. The server gathers the facts; the portal draws them on
  screen and builds the PDF in the browser (live servers have no Chrome),
  and the server's own fallback prints the same model.
*/

export type ServiceReportKind = "visit" | "call_out" | "additional_work";

export interface ServiceReportFacts {
  kind: ServiceReportKind;
  /** "Visit 3 of 4", "CO-2026-0004", "AW-2026-0012". */
  ref: string;
  contractNumber: string;
  customerName: string;
  propertyLabel: string;
  /** What the work was: a call out's trade and issue, a visit's services. */
  work: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  /** "Completed", "Partially completed (Client related: No access given)". */
  outcome: string | null;
  signedBy: string | null;
  /** A planned visit's trades, one row each. */
  lines: { service: string; outcome: string; reason: string | null }[];
  findings: string | null;
  notes: string | null;
  checklist: { label: string; result: string; note: string | null }[];
  materials: string[];
  pending: string[];
  further: string[];
  /** label: "Before", "After", "Finding"; caption: what the crew wrote. */
  photos: { url: string; label: string; caption: string | null }[];
  /** A last line under the report ("Visits this contract year: 2 done, 2 remaining."). */
  closing: string | null;
}

export const SERVICE_REPORT_NOUN: Record<ServiceReportKind, string> = { visit: "planned visit", call_out: "call out", additional_work: "additional work" };

const dateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" }).format(new Date(iso))
    : "—";

const CHECK_RESULTS: Record<string, string> = { ok: "OK", attention: "Needs attention", fault: "Fault", not_applicable: "Not applicable" };
const words = (s: string) => CHECK_RESULTS[s] ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** A photo caption of at most about two lines under the photo. */
export function shortCaption(caption: string | null, max = 90): string | null {
  const c = caption?.replace(/\s+/g, " ").trim();
  if (!c) return null;
  if (c.length <= max) return c;
  const cut = c.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut.slice(0, max)).replace(/[\s,;:.·-]+$/, "")}…`;
}

/** The report's title, for the dialog, the file and the email. */
export const serviceReportTitle = (f: Pick<ServiceReportFacts, "kind" | "ref">) =>
  f.kind === "visit" ? `Service report, ${f.ref.toLowerCase()}` : `Service report, ${SERVICE_REPORT_NOUN[f.kind]} ${f.ref}`;

export const serviceReportFileName = (f: Pick<ServiceReportFacts, "kind" | "ref" | "contractNumber">) =>
  `Service report ${f.contractNumber ? `${f.contractNumber} ` : ""}${f.ref}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");

/** The report's blocks, from its facts. */
export function buildServiceReportModel(f: ServiceReportFacts): AmcDocumentModel {
  const blocks: Block[] = [];
  let n = 0;
  const section = (text: string) => blocks.push({ kind: "heading", number: String(++n), text });
  const muted = (text: string) => blocks.push({ kind: "paragraph", runs: [t(text, { tone: "muted" })] });
  const text = (value: string | null, empty: string) => {
    if (!value?.trim()) return muted(empty);
    for (const para of value.trim().split(/\n{2,}/)) blocks.push({ kind: "paragraph", runs: [t(para.trim())] });
  };
  const bullets = (items: string[], empty: string) => (items.length ? blocks.push({ kind: "bullets", items: items.map((i) => [t(i)]) }) : muted(empty));

  blocks.push({ kind: "contactStrip" });
  blocks.push({ kind: "banner", text: f.kind === "visit" ? "PLANNED VISIT SERVICE REPORT" : f.kind === "call_out" ? "CALL OUT SERVICE REPORT" : "ADDITIONAL WORK SERVICE REPORT" });
  blocks.push(
    detailsTable([
      ["Client", f.customerName || "—"],
      ["Contract", f.contractNumber || "—"],
      ["Property", f.propertyLabel || "—"],
      [f.kind === "visit" ? "Visit" : f.kind === "call_out" ? "Call out" : "Additional work", f.ref],
      ...(f.work ? ([["Work", f.work]] as [string, string][]) : []),
      ["Arrived", dateTime(f.arrivedAt)],
      ["Completed", dateTime(f.completedAt)],
      ...(f.outcome ? ([["Outcome", [t(f.outcome, { bold: true })]]] as [string, ReturnType<typeof t>[]][]) : []),
      ["Signed by the client", f.signedBy ?? "—"],
    ]),
  );

  if (f.lines.length) {
    section("Work carried out");
    blocks.push({
      kind: "table",
      widths: [36, 22, 42],
      header: [headerCell("SERVICE"), headerCell("OUTCOME"), headerCell("REASON")],
      rows: zebra(
        f.lines.map((l) => [
          cell([[t(l.service, { bold: true })]]),
          cell([[t(l.outcome, l.outcome === "Completed" ? {} : { bold: true, tone: "brand" })]]),
          cell(l.reason ?? "—"),
        ]),
      ),
    });
  }

  section("What was found");
  text(f.findings, "Nothing recorded.");

  section("Work done and notes");
  text(f.notes, "Nothing recorded.");

  section("Checklist");
  if (f.checklist.length) {
    blocks.push({
      kind: "table",
      widths: [38, 18, 44],
      header: [headerCell("ITEM"), headerCell("RESULT", "center"), headerCell("NOTE")],
      rows: zebra(
        f.checklist.map((c) => [
          cell(c.label),
          cell([[t(words(c.result), c.result === "fault" ? { bold: true, tone: "brand" } : c.result === "attention" ? { bold: true } : {})]], { align: "center" }),
          cell(c.note ?? "—"),
        ]),
      ),
    });
  } else muted("No checklist on this visit.");

  section("Materials used");
  bullets(f.materials, "No materials used.");

  section("Pending works");
  bullets(f.pending, "Nothing pending.");

  if (f.further.length) {
    section("Further work noted");
    bullets(f.further, "");
    muted("A quotation will follow for your approval.");
  }

  if (f.photos.length) {
    section("Photos");
    /* A long caption is cut at a word, so the photos keep one size and line up (18 Nov 2026). */
    blocks.push({ kind: "photos", items: f.photos.map((p) => ({ ...p, caption: shortCaption(p.caption) })) });
  }

  if (f.closing) muted(f.closing);
  muted("Thank you for choosing Yalla Fix It. For anything about this visit, reply to this message or call 800-PERFECT.");

  return { documentType: "service_report", blocks };
}
