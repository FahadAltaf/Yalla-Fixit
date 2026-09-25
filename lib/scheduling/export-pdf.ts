import { jsPDF } from "jspdf";
import {
  APPOINTMENT_STATE_HEX,
  APPOINTMENT_STATE_LABELS,
  type AppointmentState,
} from "./appointment-status";

// A PDF that mirrors the daily board: one section per shift, technicians as
// rows (tinted by role), hours as columns, appointment bars at their times
// coloured by FSM status, lanes for overlaps, leave, and a legend. Drawn as
// vectors with jsPDF rather than screenshotting the page, so it prints crisp
// at any size and never cuts off a scrolled-away column.
//
// The board does the layout maths (placement, lanes, text lines) and passes
// plain data in; this file only draws.

export type PdfBar = {
  leftPct: number; // as placed on the board (already clamped to the window)
  widthPct: number;
  lane: number;
  allDay: boolean;
  outside: boolean; // pinned to an edge: scheduled outside this shift window
  primary: string;
  secondary: string;
  timeLabel: string;
  state: AppointmentState | "note";
  syncFailed: boolean;
  conflictsWithLeave: boolean;
};

export type PdfRow = {
  technician: string;
  role?: string | null;
  roleColor?: string | null; // hex
  service?: string | null;
  tags?: string[];
  leave?: string | null; // leave type when the technician is off that day
  laneCount: number;
  bars: PdfBar[];
};

export type PdfSection = {
  title: string;
  window: string; // "12:00 AM – 9:00 AM"
  bounds: { start: number; end: number }; // minutes of day
  rows: PdfRow[];
};

export type PdfFieldVis = { tags: boolean; roles: boolean; ids: boolean; address: boolean };

// Layout constants (mm, A4 landscape).
const MARGIN = 8;
const TECH_W = 46;
const LANE_H = 9;
const ROW_PAD = 1.2;
const HOUR_HDR_H = 6;
const SECTION_HDR_H = 7;
const BRAND: [number, number, number] = [22, 84, 74];
const INK: [number, number, number] = [20, 23, 21];
const INK_SOFT: [number, number, number] = [110, 115, 108];
const RULE: [number, number, number] = [214, 217, 209];
const NOTE_FILL = "#6b7280";
const SYNC_FAILED = "#dc2626";
const WARNING = "#d97706";
const LEAVE_TINT: [number, number, number] = [254, 243, 199];

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// The on-screen row tint is the role colour at ~6% over white.
function tint(hex: string, amount: number): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [
    Math.round(255 - (255 - r) * amount),
    Math.round(255 - (255 - g) * amount),
    Math.round(255 - (255 - b) * amount),
  ];
}

export function exportSchedulePdf(opts: {
  date: string;
  dateLabel: string;
  generatedAt: string;
  sections: PdfSection[];
  fieldVis: PdfFieldVis;
  legendStates: AppointmentState[];
  fileName?: string;
}) {
  const { dateLabel, generatedAt, sections, fieldVis, legendStates } = opts;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - MARGIN * 2;
  const trackX = MARGIN + TECH_W;
  const trackW = usableW - TECH_W;
  let y = MARGIN;

  const setFill = (rgb: [number, number, number]) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setDraw = (rgb: [number, number, number]) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  const setText = (rgb: [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  // Truncate with an ellipsis so text never spills out of its cell or bar.
  const fit = (text: string, maxW: number) => {
    if (!text) return "";
    if (doc.getTextWidth(text) <= maxW) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > maxW) t = t.slice(0, -1);
    return `${t}...`;
  };

  // Diagonal stripes inside a rectangle, for a failed sync (matches the
  // striped red bar on screen, distinct from solid red Cannot complete).
  const stripes = (x: number, top: number, w: number, h: number) => {
    setDraw([250, 190, 190]);
    doc.setLineWidth(0.35);
    for (let x0 = x - h; x0 < x + w; x0 += 2.4) {
      const x1 = Math.max(x0, x);
      const x2 = Math.min(x0 + h, x + w);
      if (x1 >= x2) continue;
      doc.line(x1, top + h - (x1 - x0), x2, top + h - (x2 - x0));
    }
  };

  // ── Title + legend ────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setText(INK);
  doc.text(`Daily schedule — ${dateLabel}`, MARGIN, y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setText(INK_SOFT);
  doc.text(`Generated ${generatedAt} (Gulf time)`, pageW - MARGIN, y + 4.5, { align: "right" });
  y += 8;

  doc.setFontSize(7);
  let lx = MARGIN;
  const legendItem = (label: string, draw: (x: number, top: number) => void) => {
    draw(lx, y);
    setText(INK_SOFT);
    doc.text(label, lx + 4.2, y + 2.6);
    lx += 4.2 + doc.getTextWidth(label) + 5;
  };
  setText(INK_SOFT);
  doc.text("Bar colour = FSM status:", lx, y + 2.6);
  lx += doc.getTextWidth("Bar colour = FSM status:") + 3;
  legendStates.forEach((state) =>
    legendItem(APPOINTMENT_STATE_LABELS[state], (x, top) => {
      setFill(hexToRgb(APPOINTMENT_STATE_HEX[state]));
      doc.rect(x, top, 3.2, 3.2, "F");
    }),
  );
  legendItem("Sync failed", (x, top) => {
    setFill(hexToRgb(SYNC_FAILED));
    doc.rect(x, top, 3.2, 3.2, "F");
    stripes(x, top, 3.2, 3.2);
  });
  legendItem("Note", (x, top) => {
    setFill(hexToRgb(NOTE_FILL));
    doc.rect(x, top, 3.2, 3.2, "F");
  });
  legendItem("Row tint = role", (x, top) => {
    setFill(tint("#dc2626", 0.18));
    setDraw(hexToRgb("#dc2626"));
    doc.setLineWidth(0.5);
    doc.rect(x, top, 3.2, 3.2, "FD");
  });
  y += 7;

  // ── Sections ──────────────────────────────────────────────────────────
  sections.forEach((section) => {
    const span = section.bounds.end - section.bounds.start || 1;
    const hours: number[] = [];
    for (let m = Math.floor(section.bounds.start / 60) * 60; m < section.bounds.end; m += 60) {
      hours.push(Math.max(m, section.bounds.start));
    }
    const xAt = (minutes: number) => trackX + ((minutes - section.bounds.start) / span) * trackW;
    const hourLabel = (minutes: number) => {
      const h = Math.floor(minutes / 60) % 24;
      return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
    };

    const drawSectionHeader = (continued: boolean) => {
      setFill(BRAND);
      doc.rect(MARGIN, y, usableW, SECTION_HDR_H, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      setText([255, 255, 255]);
      doc.text(`${section.title}${continued ? " (continued)" : ""}`, MARGIN + 2, y + 4.9);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(section.window, pageW - MARGIN - 2, y + 4.9, { align: "right" });
      y += SECTION_HDR_H;
    };

    const drawHourHeader = () => {
      setFill([233, 236, 231]);
      doc.rect(MARGIN, y, usableW, HOUR_HDR_H, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      setText([40, 46, 44]);
      doc.text("Technician", MARGIN + 1.5, y + 4.1);
      setDraw(RULE);
      doc.setLineWidth(0.15);
      hours.forEach((m) => {
        const x = xAt(m);
        doc.line(x, y, x, y + HOUR_HDR_H);
        doc.text(hourLabel(m), x + 1.2, y + 4.1);
      });
      y += HOUR_HDR_H;
    };

    // Rows that fit on this page, then the header again on the next.
    const ensureRow = (rowH: number) => {
      if (y + rowH <= pageH - MARGIN) return;
      doc.addPage();
      y = MARGIN;
      drawSectionHeader(true);
      drawHourHeader();
    };

    if (y + SECTION_HDR_H + HOUR_HDR_H + LANE_H + 4 > pageH - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
    drawSectionHeader(false);
    drawHourHeader();

    if (section.rows.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      setText(INK_SOFT);
      doc.text("No technicians match the current filters.", MARGIN + 2, y + 5);
      y += 8;
    }

    section.rows.forEach((row) => {
      const laneCount = Math.max(1, row.laneCount);
      const rowH = laneCount * LANE_H + ROW_PAD * 2;
      ensureRow(rowH);

      // Row background: role tint across the row, a role-coloured left bar,
      // and an amber track when the technician is on leave.
      if (row.roleColor) {
        setFill(tint(row.roleColor, 0.07));
        doc.rect(MARGIN, y, usableW, rowH, "F");
        setFill(hexToRgb(row.roleColor));
        doc.rect(MARGIN, y, 1.1, rowH, "F");
      }
      if (row.leave) {
        setFill(LEAVE_TINT);
        doc.rect(trackX, y, trackW, rowH, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        setText(hexToRgb(WARNING));
        doc.text(fit(`On leave: ${row.leave}`, trackW - 4), trackX + 1.5, y + 3.2);
      }

      // Hour gridlines.
      setDraw(RULE);
      doc.setLineWidth(0.12);
      hours.forEach((m) => {
        const x = xAt(m);
        doc.line(x, y, x, y + rowH);
      });

      // Technician cell.
      const nameColour: [number, number, number] = row.roleColor ? hexToRgb(row.roleColor) : INK;
      const textX = MARGIN + 2.4;
      const cellW = TECH_W - 3.5;
      let ty = y + 3.6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      setText(nameColour);
      doc.text(fit(row.technician, cellW), textX, ty);
      const maxLines = Math.max(1, Math.floor((rowH - 2) / 3.1));
      let lines = 1;
      if (fieldVis.roles && (row.role || row.service) && lines < maxLines) {
        ty += 3.1;
        lines += 1;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        setText(INK_SOFT);
        doc.text(fit([row.role, row.service].filter(Boolean).join(" · "), cellW), textX, ty);
      }
      if (fieldVis.tags && row.tags && row.tags.length > 0 && lines < maxLines) {
        ty += 3.1;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        setText(INK_SOFT);
        doc.text(fit(row.tags.join(", "), cellW), textX, ty);
      }

      // Bars.
      row.bars.forEach((bar) => {
        const x = trackX + (bar.leftPct / 100) * trackW;
        const w = Math.max((bar.widthPct / 100) * trackW, 2.5);
        const top = y + ROW_PAD + bar.lane * LANE_H + 0.5;
        const h = LANE_H - 1;
        const isNote = bar.state === "note";
        const fill = bar.syncFailed
          ? hexToRgb(SYNC_FAILED)
          : isNote
            ? hexToRgb(NOTE_FILL)
            : hexToRgb(APPOINTMENT_STATE_HEX[bar.state]);

        setFill(fill);
        if (isNote) {
          setDraw([255, 255, 255]);
          doc.setLineWidth(0.3);
          doc.setLineDashPattern([0.8, 0.8], 0);
          doc.roundedRect(x, top, w, h, 0.8, 0.8, "FD");
          doc.setLineDashPattern([], 0);
        } else {
          doc.roundedRect(x, top, w, h, 0.8, 0.8, "F");
        }
        if (bar.syncFailed) stripes(x, top, w, h);

        // Actionable states get a ring, as on screen.
        if (bar.outside || bar.conflictsWithLeave) {
          setDraw(hexToRgb(bar.outside ? WARNING : SYNC_FAILED));
          doc.setLineWidth(0.5);
          doc.roundedRect(x, top, w, h, 0.8, 0.8, "D");
        }

        // Text: primary line (bold), secondary line if the bar is tall enough.
        const innerW = w - 2.4;
        setText([255, 255, 255]);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        const marker = bar.syncFailed || bar.outside ? "! " : "";
        const primary = fit(`${marker}${bar.primary}`, innerW);
        const withSecondary = bar.secondary && h >= 7;
        const py = withSecondary ? top + 3.4 : top + h / 2 + 1.1;
        doc.text(primary, x + 1.2, py);
        if (bar.state === "cancelled") {
          setDraw([255, 255, 255]);
          doc.setLineWidth(0.3);
          doc.line(x + 1.2, py - 0.9, x + 1.2 + doc.getTextWidth(primary), py - 0.9);
        }
        if (withSecondary) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6);
          doc.text(fit(bar.secondary, innerW), x + 1.2, top + 6.6);
        }
      });

      // Row rule.
      setDraw(RULE);
      doc.setLineWidth(0.15);
      doc.line(MARGIN, y + rowH, MARGIN + usableW, y + rowH);
      y += rowH;
    });

    y += 5;
  });

  // Page numbers.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setText(INK_SOFT);
    doc.text(`Page ${i} of ${pages}`, pageW - MARGIN, pageH - 3, { align: "right" });
  }

  doc.save(opts.fileName || `schedule-${opts.date}.pdf`);
}
