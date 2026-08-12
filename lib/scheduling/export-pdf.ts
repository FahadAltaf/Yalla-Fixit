import { jsPDF } from "jspdf";

export type PdfAppointment = { time: string; label: string; address: string; freeText?: boolean };
export type PdfRow = { technician: string; sub?: string; tags?: string; appointments: PdfAppointment[] };
export type PdfSection = { title: string; rows: PdfRow[] };

export type PdfFieldVis = { tags: boolean; roles: boolean; ids: boolean; address: boolean };

type Column = { key: string; header: string; width: number };

// Generates a clean, sheet-style schedule PDF (a proper table, not a webpage
// screenshot) and triggers a download. Columns follow the field-visibility
// choices; a technician's appointments each get a row, grouped under the name.
export function exportSchedulePdf(opts: {
  date: string;
  sections: PdfSection[];
  fieldVis: PdfFieldVis;
  fileName?: string;
}) {
  const { date, sections, fieldVis } = opts;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const usableW = pageW - margin * 2;

  // Build the column set. Technician + Time are always shown; the rest follow
  // the eye-menu choices. The remaining width goes to the widest text column
  // present (Address, else Work order).
  const cols: Column[] = [{ key: "tech", header: "Technician", width: 48 }];
  if (fieldVis.roles) cols.push({ key: "sub", header: "Role / Service", width: 36 });
  cols.push({ key: "time", header: "Time", width: 30 });
  if (fieldVis.ids) cols.push({ key: "label", header: "Work order / appt.", width: 44 });
  if (fieldVis.tags) cols.push({ key: "tags", header: "Tags", width: 32 });
  if (fieldVis.address) cols.push({ key: "address", header: "Address / Notes", width: 0 }); // flexes (free-text notes land here)

  const fixed = cols.reduce((s, c) => s + c.width, 0);
  const flexCol = cols.find((c) => c.width === 0);
  if (flexCol) flexCol.width = Math.max(40, usableW - fixed);
  else cols[cols.length - 1].width += usableW - fixed; // give slack to last col

  // Column x positions.
  let acc = margin;
  const xOf: Record<string, number> = {};
  cols.forEach((c) => {
    xOf[c.key] = acc;
    acc += c.width;
  });

  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(`Schedule — ${date}`, margin, y + 5);
  y += 10;

  const drawHeaderRow = () => {
    doc.setFillColor(233, 236, 231);
    doc.rect(margin, y, usableW, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(40, 46, 44);
    cols.forEach((c) => doc.text(c.header, xOf[c.key] + 1.5, y + 4.8));
    y += 7;
  };

  sections.forEach((section) => {
    ensureSpace(20);
    // Shift heading bar
    doc.setFillColor(22, 84, 74);
    doc.rect(margin, y, usableW, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(section.title, margin + 2, y + 5.4);
    y += 8;

    drawHeaderRow();
    doc.setTextColor(20, 23, 21);

    if (section.rows.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text("No technicians in this shift.", margin + 2, y + 5);
      y += 8;
    }

    section.rows.forEach((row) => {
      const appts = row.appointments.length > 0 ? row.appointments : [{ time: "", label: "", address: "" }];

      appts.forEach((ap, i) => {
        // Measure row height from the tallest wrapping cell.
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        // Free-text entries have no WO/AP or address — their note lives in
        // `label`. Route it into a visible text column (Address preferred, then
        // Work order / appt.) so notes always show on the sheet.
        const isFree = !!ap.freeText;
        const noteCol = isFree ? (fieldVis.address ? "address" : fieldVis.ids ? "label" : null) : null;
        const labelValue = isFree ? (noteCol === "label" ? ap.label : "") : ap.label;
        const addressValue = isFree ? (noteCol === "address" ? ap.label : "") : ap.address;
        const addrLines = fieldVis.address ? doc.splitTextToSize(addressValue || "", (cols.find((c) => c.key === "address")?.width ?? 40) - 3) : [""];
        const labelLines = fieldVis.ids ? doc.splitTextToSize(labelValue || "", (cols.find((c) => c.key === "label")?.width ?? 40) - 3) : [""];
        const lineCount = Math.max(1, addrLines.length, labelLines.length);
        const rowH = Math.max(6, lineCount * 3.6 + 2);

        ensureSpace(rowH);

        // Row separator
        doc.setDrawColor(214, 217, 209);
        doc.setLineWidth(0.1);
        doc.line(margin, y, margin + usableW, y);

        const textY = y + 4;
        // Technician name (only on the first appointment row) + optional sub.
        if (i === 0) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          doc.text(doc.splitTextToSize(row.technician, cols[0].width - 3), xOf.tech + 1.5, textY);
          if (fieldVis.roles && row.sub) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.setTextColor(110, 115, 108);
            doc.text(doc.splitTextToSize(row.sub, (cols.find((c) => c.key === "sub")?.width ?? 30) - 3), xOf.sub + 1.5, textY);
            doc.setTextColor(20, 23, 21);
          }
          if (fieldVis.tags && row.tags) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.text(doc.splitTextToSize(row.tags, (cols.find((c) => c.key === "tags")?.width ?? 30) - 3), xOf.tags + 1.5, textY);
          }
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(20, 23, 21);
        if (ap.time) doc.text(ap.time, xOf.time + 1.5, textY);
        if (fieldVis.ids && labelValue) {
          doc.setFont("helvetica", isFree ? "italic" : "normal");
          doc.text(labelLines, xOf.label + 1.5, textY);
        }
        if (fieldVis.address && addressValue) {
          doc.setFont("helvetica", isFree ? "italic" : "normal");
          doc.text(addrLines, xOf.address + 1.5, textY);
        }
        doc.setFont("helvetica", "normal");

        y += rowH;
      });
    });

    // Bottom border for the section
    doc.setDrawColor(214, 217, 209);
    doc.line(margin, y, margin + usableW, y);
    y += 6;
  });

  // Column vertical guides across each page look busy; keep it clean with just
  // horizontal separators, matching the manual sheet's feel.

  doc.save(opts.fileName || `schedule-${date}.pdf`);
}
