import fs from "node:fs";
import path from "node:path";

import type { ReportData, ReportArea, ReportSnag } from "./report-data";

/**
 * The report, as HTML, from the shared report data (FR-7.02 → FR-7.06).
 *
 * One template serves both outputs. `print` adds A4 page rules and fixed
 * widths for the headless-browser PDF; `web` drops them and adds the
 * breakpoints, so a phone gets a readable document rather than a sideways
 * A4 sheet. The markup and the numbers are identical either way, which is
 * the point: two renderers reading one `buildReportData()` cannot disagree
 * about how many snags an inspection has.
 *
 * Plain string HTML rather than React: this runs inside a Node route with no
 * DOM, and the PDF path hands the result straight to Chrome. There is no
 * component tree to reconcile and nothing interactive on the page.
 */

export type ReportHtmlMode = "print" | "web";

const BRAND = "#8c1d24";
const INK = "#17191b";
const SUB = "#5b5f63";
const FAINT = "#8b8f93";
const LINE = "#e3dedb";
const CARD = "#f7f5f4";

const SEVERITY_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  high: { bg: "#fbeded", fg: "#a81d1d", label: "High" },
  medium: { bg: "#fbf1e4", fg: "#9a5108", label: "Medium" },
  low: { bg: "#eef2fb", fg: "#2c4f9e", label: "Low" },
};

const ACCESS_LABEL: Record<string, string> = {
  not_accessible: "No access",
  limited_access: "Limited access",
};

/**
 * The wordmark, inlined as a data URI.
 *
 * The PDF path hands Chrome the document through `setContent`, which gives
 * the page no base URL — so `/yalla-fixit.png` resolves against nothing and
 * the logo prints as a broken image. Inlining sidesteps that without making
 * report rendering depend on the app being reachable from its own server.
 * Read once and cached: this is called for every report.
 */
let logoCache: string | null = null;
function logoSrc(): string {
  if (logoCache !== null) return logoCache;
  try {
    const file = path.join(process.cwd(), "public", "yalla-fixit.png");
    logoCache = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    // A missing asset must not take the whole report down; the masthead
    // still carries the wordmark in text.
    logoCache = "";
  }
  return logoCache;
}

/** How this visit is described on the cover: "Initial inspection", etc. */
function visitLabel(data: ReportData): string {
  if (data.visitType === "desnag") return `De-snag round ${data.roundNumber}`;
  if (data.visitType === "additional") return "Additional visit";
  return "Initial inspection";
}

/** One severity figure, tinted only when it is not zero. */
function severityStat(severity: "high" | "medium" | "low", count: number): string {
  const tone = SEVERITY_TONE[severity];
  // A zero stays neutral: colouring it makes an inspection with no high-
  // severity defects look as though it has some.
  const style = count > 0 ? ` style="background:${tone.bg};border-color:${tone.bg}"` : "";
  const value = count > 0 ? ` style="color:${tone.fg}"` : "";
  return `<div class="stat"${style}>
      <span class="stat__value"${value}>${count}</span>
      <span class="stat__label">${tone.label}</span>
    </div>`;
}

/** Everything interpolated into the document goes through this. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}

function severityChip(severity: string): string {
  const tone = SEVERITY_TONE[severity] ?? SEVERITY_TONE.low;
  return `<span class="chip" style="background:${tone.bg};color:${tone.fg}">${esc(tone.label)}</span>`;
}

/**
 * A photo with the inspector's marked spot drawn on it (FR-7.03).
 *
 * The marker is stored as a fraction of the image in each axis, so it is
 * positioned in percentages over a wrapper the image itself sizes -- correct
 * at any dimension or aspect ratio, and correct in the PDF where the image
 * is scaled to the page.
 */
function photoFigure(photo: ReportSnag["photos"][number]): string {
  if (!photo.url) return "";
  if (photo.mediaType === "video") {
    return `<div class="photo photo--video"><span>Video evidence</span></div>`;
  }
  const marker = photo.marker
    ? `<span class="marker" style="left:${(photo.marker.x * 100).toFixed(2)}%;top:${(photo.marker.y * 100).toFixed(2)}%"></span>
       <span class="marker-tag">Marked defect</span>`
    : "";
  return `<figure class="photo">
    <img src="${esc(photo.url)}" alt="Defect evidence" loading="eager" />
    ${marker}
  </figure>`;
}

function snagBlock(snag: ReportSnag): string {
  const photos = snag.photos.filter((photo) => photo.url).map(photoFigure).join("");
  return `<article class="snag">
    <header class="snag__head">
      <div class="snag__title">
        <span class="snag__defect">${esc(snag.defect ?? "Defect")}</span>
        ${snag.subCategory ? `<span class="snag__sub">${esc(snag.subCategory)}</span>` : ""}
      </div>
      <div class="snag__meta">
        ${severityChip(snag.severity)}
        ${snag.code ? `<span class="mono">${esc(snag.code)}</span>` : ""}
      </div>
    </header>
    ${
      snag.description
        ? `<p class="snag__desc">${esc(snag.description)}</p>`
        : ""
    }
    ${snag.note ? `<p class="snag__note"><span class="label">Inspector note</span>${esc(snag.note)}</p>` : ""}
    ${photos ? `<div class="photos">${photos}</div>` : `<p class="snag__none">No photo evidence recorded.</p>`}
  </article>`;
}

function areaSection(area: ReportArea): string {
  const access =
    area.accessState && area.accessState !== "accessible"
      ? `<div class="area__access">
           <span class="chip chip--warn">${esc(ACCESS_LABEL[area.accessState] ?? area.accessState)}</span>
           ${area.accessReason ? `<span>${esc(area.accessReason)}</span>` : ""}
         </div>`
      : "";

  const body =
    area.snags.length > 0
      ? area.snags.map(snagBlock).join("")
      : `<p class="area__clear">No defects recorded in this area.</p>`;

  return `<section class="area">
    <h3 class="area__name">
      ${esc(area.name)}
      <span class="area__count">${area.snags.length} ${area.snags.length === 1 ? "defect" : "defects"}</span>
    </h3>
    ${access}
    ${body}
  </section>`;
}

/** FR-7.06 — what the inspection did not cover, said plainly. */
function coverageSection(data: ReportData): string {
  const { areas, checklist } = data.coverage;
  if (areas.length === 0 && checklist.length === 0) return "";

  /*
    Name and reason read as one sentence -- "Family room — Key not provided" --
    with the access state as a quiet tag on the right. The state is the
    filter a reader scans for; the reason is what they actually need.
  */
  const areaRows = areas
    .map(
      (area) => `<li>
        <div class="gap__head">
          <span class="gap__name">
            <strong>${esc(area.name)}</strong>
            ${area.reason ? `<span class="gap__why">— ${esc(area.reason)}</span>` : ""}
          </span>
          <span class="tag tag--${area.accessState === "not_accessible" ? "none" : "limited"}">${esc(
            ACCESS_LABEL[area.accessState] ?? area.accessState,
          )}</span>
        </div>
        ${
          area.elementsNotChecked
            ? `<p class="gap__reason"><span class="label">Not checked</span>${esc(area.elementsNotChecked)}</p>`
            : ""
        }
      </li>`,
    )
    .join("");

  const checkRows = checklist
    .map(
      (item) => `<li>
        <div class="gap__head">
          <strong>${esc(item.label)}</strong>
          <span class="chip chip--warn">${item.status === "not_checked" ? "Not checked" : "Not answered"}</span>
        </div>
        ${item.groupName ? `<p class="gap__reason">${esc(item.groupName)}</p>` : ""}
        ${item.reason ? `<p class="gap__reason">${esc(item.reason)}</p>` : ""}
      </li>`,
    )
    .join("");

  return `<section class="block">
    <h2 class="section">Areas not fully inspected</h2>
    <p class="block__lead">
      These parts of the property could not be fully checked on the day. They are
      listed so nothing is assumed to have passed simply because no defect is
      recorded against it.
    </p>
    ${areas.length > 0 ? `<h4 class="gap__title">Areas</h4><ul class="gaps">${areaRows}</ul>` : ""}
    ${checklist.length > 0 ? `<h4 class="gap__title">Checks</h4><ul class="gaps">${checkRows}</ul>` : ""}
  </section>`;
}

function coverBlock(data: ReportData, version: number | null): string {
  const { cover } = data;
  const total = Math.max(1, cover.totalSnags);
  const affected = cover.mostAffectedSubCategories
    .map(
      (row, index) => `<li>
        <span class="rank">${index + 1}</span>
        <span class="rank__label">${esc(row.label)}</span>
        <span class="bar"><span class="bar__fill" style="width:${Math.max(4, Math.round((row.count / total) * 100))}%"></span></span>
        <span class="rank__count">${row.count}</span>
      </li>`,
    )
    .join("");

  return `<header class="masthead">
    <div class="masthead__brand">
      <img class="masthead__logo" src="${logoSrc()}" alt="" />
      <div>
        <div class="wordmark">Yalla Fix It</div>
        <div class="masthead__sub">Office 102, Building 6, Gold &amp; Diamond Park, Dubai</div>
        <div class="masthead__sub masthead__site">https://www.yallafixit.ae</div>
      </div>
    </div>
    <div class="masthead__doc">
      <div class="doc__type">Snagging inspection report</div>
      <div class="doc__code mono">${esc(data.code)}</div>
      <div class="doc__date">${fmtDate(data.generatedAt)}${version ? ` · Version ${version}` : ""}</div>
    </div>
  </header>

  <div class="rule"></div>

  <section class="parties">
    <div class="party">
      <span class="party__label">Property</span>
      <span class="party__name">${esc(cover.unit)}</span>
      ${cover.address ? `<span class="party__line">${esc(cover.address)}</span>` : ""}
      ${cover.propertyType ? `<span class="party__line">${esc(cover.propertyType)}</span>` : ""}
      ${
        cover.developer
          ? `<span class="party__line party__meta">Developer: <b>${esc(cover.developer)}</b></span>`
          : ""
      }
    </div>
    <div class="party">
      <span class="party__label">Client</span>
      <span class="party__name">${esc(cover.client.name ?? "—")}</span>
      ${cover.client.email ? `<span class="party__line party__link">${esc(cover.client.email)}</span>` : ""}
      ${cover.client.phone ? `<span class="party__line">${esc(cover.client.phone)}</span>` : ""}
    </div>
  </section>

  <section class="visitbar">
    <span>Visit: <b>${esc(visitLabel(data))}</b></span>
    <span>Inspected: <b>${fmtDate(cover.inspectionDate)}</b></span>
    <span>Inspector: <b>${esc(cover.inspector ?? "—")}</b></span>
  </section>

  <h2 class="section">Summary</h2>
  <section class="summary">
    <div class="stat">
      <span class="stat__value">${cover.totalSnags}</span>
      <span class="stat__label">Total snags</span>
    </div>
    ${severityStat("high", cover.severity.high)}
    ${severityStat("medium", cover.severity.medium)}
    ${severityStat("low", cover.severity.low)}
    <div class="stat">
      <span class="stat__value">${data.tally.areasWalked}/${data.tally.areasTotal}</span>
      <span class="stat__label">Areas walked</span>
    </div>
    <div class="stat">
      <span class="stat__value">${data.tally.checklistDone}/${data.tally.checklistTotal}</span>
      <span class="stat__label">Checklist</span>
    </div>
  </section>

  ${
    affected
      ? `<h2 class="section">Most affected sub-categories</h2>
         <ol class="ranks card">${affected}</ol>`
      : ""
  }`;
}

/**
 * Renders one report to a complete HTML document.
 *
 * `version` is stamped on the cover so a client holding a printout can tell
 * which issue they have (FR-7.08).
 */
export function renderReportHtml(
  data: ReportData,
  options: {
    mode: ReportHtmlMode;
    version?: number | null;
    reportType?: string;
    /**
     * Returns `<style>` + `<main>` only, with no document wrapper, for
     * embedding in a React page. The PDF path needs the whole document
     * because Chrome is handed it directly.
     */
    fragment?: boolean;
  },
): string {
  const { mode, version = null, reportType = "inspection", fragment = false } = options;
  const print = mode === "print";

  const areas = data.areas.map(areaSection).join("");
  const unassigned =
    data.unassignedSnags.length > 0
      ? areaSection({
          id: "unassigned",
          name: "Not assigned to an area",
          sortOrder: Number.MAX_SAFE_INTEGER,
          accessState: null,
          accessReason: null,
          elementsNotChecked: null,
          confirmedAt: null,
          snags: data.unassignedSnags,
        })
      : "";

  const roundBanner =
    reportType === "round"
      ? `<div class="banner">De-snag round ${data.roundNumber} — findings from this return visit only.</div>`
      : reportType === "cumulative"
        ? `<div class="banner">Cumulative report — the current state of every defect raised on this property.</div>`
        : "";

  const styles = `<style>
  :root {
    --brand: ${BRAND};
    --ink: ${INK};
    --sub: ${SUB};
    --faint: ${FAINT};
    --line: ${LINE};
    --card: ${CARD};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: ${print ? "10.5px" : "15px"};
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    ${print ? "width: 794px;" : "max-width: 900px;"}
    margin: 0 auto;
    padding: ${print ? "24px 32px" : "20px 16px 64px"};
  }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }

  /* masthead */
  .masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .masthead__brand { display: flex; align-items: flex-start; gap: ${print ? "10px" : "14px"}; }
  .masthead__logo { width: ${print ? "38px" : "52px"}; height: auto; flex: none; }
  .masthead__site { color: var(--brand); }
  .wordmark { font-size: ${print ? "15px" : "20px"}; font-weight: 800; letter-spacing: -0.3px; }
  .masthead__sub { font-size: ${print ? "8.5px" : "12px"}; color: var(--sub); margin-top: 2px; }
  .masthead__doc { text-align: right; }
  .doc__type { font-size: ${print ? "10px" : "13px"}; font-weight: 700; color: var(--brand); text-transform: uppercase; letter-spacing: 0.4px; }
  .doc__code { font-size: ${print ? "12px" : "16px"}; font-weight: 700; margin-top: 2px; }
  .doc__date { font-size: ${print ? "8.5px" : "12px"}; color: var(--faint); }
  .rule { height: 2px; background: var(--brand); border-radius: 2px; margin: 8px 0 12px; }

  .banner {
    background: #fbf1f1; border-left: 3px solid var(--brand);
    padding: 8px 12px; font-size: ${print ? "9.5px" : "13px"};
    border-radius: 4px; margin-bottom: 12px;
  }

  /* cover facts */
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .party { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: ${print ? "8px 12px" : "12px 14px"}; }
  .party__label { display: block; font-size: ${print ? "7.5px" : "11px"}; text-transform: uppercase; letter-spacing: 0.5px; color: var(--faint); }
  .party__name { display: block; font-weight: 800; font-size: ${print ? "13px" : "18px"}; margin-top: 3px; word-break: break-word; }
  .party__line { display: block; font-size: ${print ? "8.5px" : "12px"}; color: var(--sub); margin-top: 2px; word-break: break-word; }
  .party__link { color: var(--brand); }
  .party__meta { color: var(--faint); margin-top: 4px; }

  /* The one dark band on the page: who walked it, and when. */
  .visitbar {
    display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    background: var(--ink); color: #ffffff; border-radius: 6px;
    padding: ${print ? "6px 12px" : "9px 14px"};
    font-size: ${print ? "8.5px" : "12px"}; margin-bottom: 14px;
  }
  .visitbar b { font-weight: 700; }

  .summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 16px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; text-align: center; }
  .stat__value { display: block; font-size: ${print ? "20px" : "28px"}; font-weight: 800; line-height: 1.1; }
  .stat__label { display: block; font-size: ${print ? "7.5px" : "11px"}; text-transform: uppercase; letter-spacing: 0.5px; color: var(--sub); margin-top: 2px; }

  /* blocks */
  .block { margin-bottom: 18px; }
  h2 {
    font-size: ${print ? "11px" : "16px"}; text-transform: uppercase; letter-spacing: 0.5px;
    margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1.5px solid var(--brand);
  }
  /* A heading that follows a filled block needs air above it. */
  h2.section { margin-top: ${print ? "10px" : "16px"}; }
  .block__lead { color: var(--sub); font-size: ${print ? "9.5px" : "14px"}; margin: 0 0 10px; }

  .ranks { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
  .ranks li { display: flex; align-items: center; gap: 10px; padding: ${print ? "0 12px 8px" : "0 14px 10px"}; padding-top: ${print ? "8px" : "10px"}; border-top: 1px solid var(--line); }
  .ranks li:first-child { border-top: none; }
  .rank { width: 14px; color: var(--faint); font-size: ${print ? "9px" : "12px"}; }
  .rank__label { flex: 1; font-weight: 600; }
  .rank__count { width: 26px; text-align: right; font-weight: 700; }
  .bar { width: ${print ? "90px" : "140px"}; height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
  .bar__fill { display: block; height: 6px; background: var(--brand); }
  .gap__name { flex: 1; }
  .gap__why { color: var(--sub); font-weight: 400; margin-left: 4px; }
  .tag {
    flex: none; font-size: ${print ? "7px" : "10px"}; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .tag--none { color: ${SEVERITY_TONE.high.fg}; }
  .tag--limited { color: ${SEVERITY_TONE.medium.fg}; }

  /* areas + snags */
  .area { border: 1px solid var(--line); border-radius: 8px; margin-bottom: 10px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
  .area__name { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0; background: var(--card); border-bottom: 1px solid var(--line); padding: ${print ? "7px 14px" : "12px 16px"}; font-size: ${print ? "11px" : "16px"}; }
  .area__count { font-weight: 400; font-size: ${print ? "8.5px" : "13px"}; color: var(--sub); }
  .area__access { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: ${print ? "6px 14px" : "10px 16px"}; background: #fbf1e4; font-size: ${print ? "9.5px" : "13px"}; }
  .area__clear { margin: 0; padding: ${print ? "8px 14px" : "14px 16px"}; color: var(--sub); font-size: ${print ? "9.5px" : "14px"}; }

  .snag { padding: ${print ? "8px 14px" : "14px 16px"}; border-top: 1px solid var(--line); break-inside: avoid; page-break-inside: avoid; }
  .snag:first-of-type { border-top: none; }
  .snag__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .snag__defect { font-weight: 700; font-size: ${print ? "10.5px" : "15px"}; }
  .snag__sub { color: var(--sub); font-size: ${print ? "9.5px" : "13px"}; margin-left: 6px; }
  .snag__meta { display: flex; align-items: center; gap: 8px; font-size: ${print ? "8.5px" : "12px"}; color: var(--faint); }
  .snag__desc { margin: 4px 0 0; color: var(--sub); font-size: ${print ? "9.5px" : "14px"}; }
  .snag__note { margin: 6px 0 0; font-size: ${print ? "9.5px" : "14px"}; }
  .snag__none { margin: 6px 0 0; color: var(--faint); font-size: ${print ? "9px" : "13px"}; font-style: italic; }
  .label { display: block; font-size: ${print ? "7.5px" : "11px"}; text-transform: uppercase; letter-spacing: 0.5px; color: var(--faint); }

  .chip { display: inline-block; border-radius: 9px; padding: 1px 7px; font-size: ${print ? "7.5px" : "11px"}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .chip--warn { background: #fbf1e4; color: #9a5108; }

  .photos { display: grid; grid-template-columns: repeat(${print ? 4 : 2}, 1fr); gap: 8px; margin-top: 8px; }
  .photo { position: relative; margin: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--card); aspect-ratio: 4 / 3; }
  .photo img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .photo--video { display: flex; align-items: center; justify-content: center; color: var(--sub); font-size: ${print ? "8.5px" : "12px"}; }
  .marker { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border: 2px solid #a81d1d; background: rgba(168,29,29,0.22); border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,0.85); }
  .marker-tag { position: absolute; top: 4px; left: 4px; background: #a81d1d; color: #fff; font-size: ${print ? "6.5px" : "10px"}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 1px 5px; border-radius: 3px; }

  .gaps { list-style: none; margin: 0 0 10px; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
  .gaps li { padding: ${print ? "7px 14px" : "12px 16px"}; border-top: 1px solid var(--line); }
  .gaps li:first-child { border-top: none; }
  .gap__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .gap__reason { margin: 3px 0 0; color: var(--sub); font-size: ${print ? "9.5px" : "13px"}; }
  .gap__title { font-size: ${print ? "9px" : "13px"}; text-transform: uppercase; letter-spacing: 0.5px; color: var(--faint); margin: 10px 0 4px; }

  .signoff { border: 1px solid var(--line); border-radius: 8px; background: var(--card); padding: ${print ? "10px 14px" : "16px"}; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
  .signoff img { max-height: ${print ? "48px" : "64px"}; }
  .footnote { margin-top: 12px; color: var(--faint); font-size: ${print ? "7.5px" : "11px"}; text-align: center; }

  ${
    print
      ? `@page { size: A4; margin: 10mm 0; }
         .page { padding-top: 0; padding-bottom: 0; }`
      : `@media (max-width: 720px) {
           .parties { grid-template-columns: 1fr; }
           .summary { grid-template-columns: repeat(3, 1fr); }
           .photos { grid-template-columns: 1fr; }
           /* One column: a company address and a document code cannot sit
              side by side at phone width without pushing the page out. */
           .masthead { flex-direction: column; gap: 8px; }
           .masthead__doc { text-align: left; }
           .snag__head { flex-direction: column; align-items: flex-start; gap: 4px; }
           .snag__sub { margin-left: 0; }
         }
         @media (max-width: 420px) {
           .parties { grid-template-columns: 1fr; }
           .summary { grid-template-columns: repeat(2, 1fr); }
           .bar { width: 80px; }
         }`
  }
</style>`;

  const body = `<main class="page">
  ${coverBlock(data, version)}
  ${roundBanner}
  ${coverageSection(data)}

  <section class="block">
    <h2>Defects by area</h2>
    ${areas || `<p class="block__lead">No defects were recorded on this inspection.</p>`}
    ${unassigned}
  </section>

  ${
    data.signOff.signedAt
      ? `<section class="block">
           <h2>Sign-off</h2>
           <div class="signoff">
             <div>
               <span class="label">Signed by</span>
               <strong>${esc(data.signOff.signerName ?? "—")}</strong>
               <div class="doc__date">${fmtDate(data.signOff.signedAt)}</div>
             </div>
             ${data.signOff.signatureUrl ? `<img src="${esc(data.signOff.signatureUrl)}" alt="Client signature" />` : ""}
           </div>
         </section>`
      : ""
  }

  <p class="footnote">
    This report records the condition observed at the time of inspection. Defects are
    classified by severity for prioritisation and do not constitute a structural or
    legal certification. Yalla Fix It Property Care.
  </p>
</main>`;

  if (fragment) return `${styles}${body}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(data.code)} — Snagging inspection report</title>
${styles}
</head>
<body>
${body}
</body>
</html>`;
}
