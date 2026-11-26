/**
 * DEV-486 (26 Nov 2026): reading the AMC department's contract tracker
 * ("AMC Consolidated, YFI format", saved as CSV) into contracts the portal
 * can import. Pure: no database. lib/server/amc/tracker-import.ts writes.
 *
 * Jira DEV-486 and the user's decisions of 26 Nov 2026:
 *   - every row is imported, current and expired; expired ones stay history;
 *   - the Customer ID is kept as the tracker shows it;
 *   - no FSM contact or address is made and no client is told anything;
 *   - no payment terms -> no instalment schedule; the contract type is a label;
 *   - a visit date before today was done; from today on it is planned (the
 *     CSV carries no tracker colours, so the date decides);
 *   - visit dates before a contract's own start belong to the term before:
 *     they go on that earlier contract (the tracker's own row when it has
 *     one, else an expired contract made for them), and the later contract
 *     is linked to it as its renewal.
 */

export type TrackerService = {
  /** The tracker's column, e.g. "AC Service". */
  column: string;
  /** Visits a year, when the tracker says or the dates show it. */
  perYear: number | null;
  /** Hours (handyman) or call outs; null = unlimited when `unlimited`. */
  quantity: number | null;
  unlimited: boolean;
  /** Every visit date in the row, oldest first (ISO). */
  dates: string[];
  /** The tracker's words when it gave no dates, e.g. "Quarterly - no visit logged". */
  note: string | null;
};

export type TrackerVisit = {
  date: string;
  /** Before today: done; from today: planned. */
  state: "done" | "planned";
  /** The services done on that day (tracker columns). */
  services: string[];
};

export type TrackerContract = {
  /** Where it came from: a CSV line number, or "line N (earlier term)". */
  source: string;
  /** Made by the import for visits from the term before this file's contract. */
  synthesized: boolean;
  proposalNumber: string | null;
  contractTypeLabel: string;
  contractType: "comprehensive" | "semi_comprehensive" | "non_comprehensive" | "ac_only" | null;
  startDate: string;
  endDate: string;
  status: "active" | "expired" | "upcoming";
  customer: {
    ref: string | null;
    name: string;
    phone: string | null;
    email: string | null;
    /** Further emails the tracker listed in the same cell. */
    otherEmails: string[];
  };
  property: {
    unit: string | null;
    building: string | null;
    community: string | null;
    area: string | null;
    type: string | null;
    bedrooms: string | null;
    acUnits: number | null;
  };
  services: TrackerService[];
  visits: TrackerVisit[];
  totalAed: number | null;
  paymentTerms: string | null;
  handler: string | null;
  /** Index (in `contracts`) of the contract this one renews. */
  renewsIndex: number | null;
  issues: string[];
};

export type TrackerParse = {
  contracts: TrackerContract[];
  /** Problems with the file itself (header not recognised and the like). */
  problems: string[];
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** "05-Jul-2026", "01-Sep-25", "2026-07-05" -> ISO date, else null. */
export function trackerDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})[-\s/]([A-Za-z]{3,4})[-\s/](\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const day = Number(m[1]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** A minimal RFC 4180 reader: quotes, doubled quotes, commas and newlines inside quotes. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return t && !/^(n\/?a|-|—)$/i.test(t) ? t : null;
};

/** "Annual - non-comprehensive" and its spellings -> the portal's contract type. */
export function contractTypeOf(label: string): TrackerContract["contractType"] {
  const l = label.toLowerCase().replace(/[^a-z]/g, "");
  if (l.includes("semicomprehensive")) return "semi_comprehensive";
  if (l.includes("noncomprehensive")) return "non_comprehensive";
  if (l.includes("aconly")) return "ac_only";
  if (l.includes("comprehensive")) return "comprehensive";
  return null;
}

/** Visits a year from the tracker's words ("Quarterly - no visit logged", "24x/yr", "36xyr", "Biannual"). */
export function perYearFromWords(text: string): number | null {
  const t = text.toLowerCase();
  const times = /(\d+)\s*x\s*\/?\s*y(ea)?r/.exec(t);
  if (times) return Number(times[1]);
  if (t.includes("daily")) return 365;
  if (t.includes("weekly")) return 52;
  if (t.includes("monthly")) return 12;
  if (t.includes("quarterly")) return 4;
  if (t.includes("biannual") || t.includes("bi-annual") || t.includes("half yearly") || t.includes("half-yearly") || t.includes("semi annual")) return 2;
  if (t.includes("annual") || t.includes("yearly")) return 1;
  return null;
}

/** The tracker's service columns that count hours or call outs rather than visits. */
const QUANTITY_COLUMNS = new Set(["Handyman Hrs", "Emergency Call-out", "Non-Emergency Call-out"]);
const FIXED = ["Proposal No.", "Contract Type", "Start Date", "Expiry Date", "Customer ID", "Customer Name", "Mobile", "Email", "Unit No.", "Building", "Community", "Area", "Property Type", "Bedrooms", "AC Units"];
const TAIL = ["Total AED (VAT incl.)", "Payment Terms", "Handler"];

const addYears = (iso: string, years: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const num = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && /\d/.test(v) ? n : null;
};

const norm = (v: string | null | undefined) => (v ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
/** The same unit: where a renewal and the contract before it meet. */
const unitKey = (c: TrackerContract) => [norm(c.property.unit), norm(c.property.building), norm(c.property.community)].join("|");
/**
 * The same holder: the tracker's Customer ID, or the name. Either is enough,
 * because the tracker gives one client two IDs over the years (a renewal
 * under a new YFI number) and spells a name two ways.
 */
const sameHolder = (a: TrackerContract, b: TrackerContract) =>
  (Boolean(norm(a.customer.ref)) && norm(a.customer.ref) === norm(b.customer.ref)) || norm(a.customer.name) === norm(b.customer.name);

export function parseTracker(text: string, today: string): TrackerParse {
  const problems: string[] = [];
  const rows = readCsv(text.replace(/^﻿/, ""));
  const headerAt = rows.findIndex((r) => r.some((c) => c.trim() === "Proposal No.") && r.some((c) => c.trim() === "Customer ID"));
  if (headerAt < 0) return { contracts: [], problems: ["This is not the AMC tracker: no row has both \"Proposal No.\" and \"Customer ID\"."] };
  const head = rows[headerAt].map((c) => c.trim());
  const sub = (rows[headerAt + 1] ?? []).map((c) => c.trim());
  const subIsOrdinals = sub.some((c) => /^\d+(st|nd|rd|th)$/i.test(c));

  const col = (name: string) => head.indexOf(name);
  for (const name of [...FIXED, ...TAIL]) if (col(name) < 0) problems.push(`Column "${name}" is missing.`);
  if (problems.length) return { contracts: [], problems };

  /* Each service: the columns under its heading (1st, 2nd ... visit), up to the next heading. */
  const firstService = col("AC Units") + 1;
  const lastService = col("Total AED (VAT incl.)");
  const groups: Array<{ name: string; cols: number[] }> = [];
  for (let i = firstService; i < lastService; i += 1) {
    if (head[i]) groups.push({ name: head[i], cols: [i] });
    else if (groups.length) groups[groups.length - 1].cols.push(i);
  }

  const contracts: TrackerContract[] = [];
  const firstData = headerAt + (subIsOrdinals ? 2 : 1);
  for (let r = firstData; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row.some((c) => c.trim())) continue;
    const cell = (name: string) => clean(row[col(name)]);
    const issues: string[] = [];
    const line = `line ${r + 1}`;

    const start = trackerDate(row[col("Start Date")] ?? "");
    const end = trackerDate(row[col("Expiry Date")] ?? "");
    const name = cell("Customer Name");
    if (!name) {
      problems.push(`${line}: no customer name; the row is left out.`);
      continue;
    }
    if (!start || !end || end <= start) {
      problems.push(`${line} (${name}): the start or expiry date is missing or not after the start; the row is left out.`);
      continue;
    }

    const services: TrackerService[] = [];
    for (const g of groups) {
      const values = g.cols.map((i) => clean(row[i])).filter((v): v is string => Boolean(v));
      if (!values.length) continue;
      const dates = [...new Set(values.map(trackerDate).filter((d): d is string => Boolean(d)))].sort();
      const words = values.filter((v) => !trackerDate(v));
      if (QUANTITY_COLUMNS.has(g.name)) {
        const word = words.join(" ");
        services.push({ column: g.name, perYear: null, quantity: /unlimited/i.test(word) ? null : num(word), unlimited: /unlimited/i.test(word), dates: [], note: null });
        continue;
      }
      const note = words.join("; ") || null;
      const fromWords = note ? perYearFromWords(note) : null;
      /* A bare number under a visit column is its visits a year (e.g. "12"). */
      const bare = words.length === 1 && /^\d+$/.test(words[0]) ? Number(words[0]) : null;
      services.push({ column: g.name, perYear: fromWords ?? bare ?? (dates.length || null), quantity: null, unlimited: false, dates, note });
      if (words.some((w) => !perYearFromWords(w) && !/^\d+$/.test(w))) issues.push(`${g.name}: "${words.join("; ")}" was not understood as a frequency.`);
    }

    const emailCell = cell("Email") ?? "";
    const emails = emailCell.split(/[\s/;,]+/).filter((e) => /@/.test(e));
    const ref = cell("Customer ID");
    if (!ref) issues.push("No Customer ID in the tracker; the client gets the next portal Client ID.");
    const typeLabel = cell("Contract Type") ?? "";
    const contractType = contractTypeOf(typeLabel);
    if (!contractType) issues.push(`Contract type "${typeLabel}" was not recognised; kept as a label only.`);
    const total = num(cell("Total AED (VAT incl.)"));
    if (total === null) issues.push("No contract value in the tracker.");
    const terms = cell("Payment Terms");

    contracts.push({
      source: line,
      synthesized: false,
      proposalNumber: cell("Proposal No."),
      contractTypeLabel: typeLabel,
      contractType,
      startDate: start,
      endDate: end,
      status: end < today ? "expired" : start > today ? "upcoming" : "active",
      customer: { ref, name, phone: cell("Mobile"), email: emails[0] ?? null, otherEmails: emails.slice(1) },
      property: {
        unit: cell("Unit No."),
        building: cell("Building"),
        community: cell("Community"),
        area: cell("Area"),
        type: cell("Property Type"),
        bedrooms: cell("Bedrooms"),
        acUnits: num(cell("AC Units")),
      },
      services,
      visits: [],
      totalAed: total,
      paymentTerms: terms,
      handler: cell("Handler"),
      renewsIndex: null,
      issues,
    });
  }

  /* Renewals: the same unit and the same holder, one term after another (never two renewing the same contract). */
  const byUnit = new Map<string, number[]>();
  contracts.forEach((c, i) => byUnit.set(unitKey(c), [...(byUnit.get(unitKey(c)) ?? []), i]));
  for (const list of byUnit.values()) {
    list.sort((a, b) => contracts[a].startDate.localeCompare(contracts[b].startDate));
    const renewed = new Set<number>();
    for (let k = 1; k < list.length; k += 1) {
      const later = contracts[list[k]];
      for (let j = k - 1; j >= 0; j -= 1) {
        const earlier = contracts[list[j]];
        if (!renewed.has(list[j]) && earlier.startDate < later.startDate && sameHolder(earlier, later)) {
          later.renewsIndex = list[j];
          renewed.add(list[j]);
          break;
        }
      }
    }
  }

  /* Visit dates before a contract's start belong to the term before it. */
  const count = contracts.length;
  for (let i = 0; i < count; i += 1) {
    const c = contracts[i];
    const early = new Set(c.services.flatMap((s) => s.dates.filter((d) => d < c.startDate)));
    const late = c.services.flatMap((s) => s.dates.filter((d) => d > c.endDate));
    if (late.length) c.issues.push(`${late.length} visit date(s) after the contract ends (${[...new Set(late)].sort()[0]} onwards) are left out.`);
    if (!early.size) continue;

    let before = c.renewsIndex !== null ? contracts[c.renewsIndex] : null;
    if (!before || [...early].some((d) => d < before!.startDate || d > before!.endDate)) {
      /* The tracker has no row for that term: an expired contract is made for it. */
      const prevStart = addYears(c.startDate, -1);
      before = {
        ...c,
        source: `${c.source} (earlier term)`,
        synthesized: true,
        proposalNumber: null,
        startDate: prevStart,
        endDate: addDays(c.startDate, -1),
        status: addDays(c.startDate, -1) < today ? "expired" : "active",
        services: c.services.map((s) => ({ ...s, dates: s.dates.filter((d) => d < c.startDate) })),
        renewsIndex: c.renewsIndex,
        issues: [`Made by the import: the tracker's row for ${c.customer.name} lists visits from ${prevStart} to ${addDays(c.startDate, -1)}, before that contract starts. Its value and services are copied from the later contract.`],
      };
      contracts.push(before);
      c.renewsIndex = contracts.length - 1;
    } else {
      for (const s of c.services) {
        const moved = s.dates.filter((d) => d < c.startDate);
        if (!moved.length) continue;
        const target = before.services.find((t) => t.column === s.column);
        if (target) target.dates = [...new Set([...target.dates, ...moved])].sort();
        else before.services.push({ ...s, dates: moved });
      }
    }
    c.issues.push(`${early.size} visit date(s) before the start moved to the earlier contract (${before.startDate} to ${before.endDate}).`);
    for (const s of c.services) s.dates = s.dates.filter((d) => d >= c.startDate && d <= c.endDate);
  }

  /* One visit per date, with every service done that day. */
  for (const c of contracts) {
    const days = new Map<string, string[]>();
    for (const s of c.services) for (const d of s.dates) days.set(d, [...(days.get(d) ?? []), s.column]);
    c.visits = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, svc]) => ({ date, state: date < today ? "done" : "planned", services: svc }));
    if (!c.services.length) c.issues.push("No services in the tracker for this contract.");
    if (c.paymentTerms === null && c.status !== "expired") c.issues.push("No payment terms: no instalment schedule is made (DEV-486).");
  }

  return { contracts, problems };
}

/** The figures a preview shows before anything is written. */
export function trackerSummary(parsed: TrackerParse) {
  const c = parsed.contracts;
  return {
    contracts: c.length,
    fromFile: c.filter((x) => !x.synthesized).length,
    earlierTerms: c.filter((x) => x.synthesized).length,
    active: c.filter((x) => x.status === "active").length,
    expired: c.filter((x) => x.status === "expired").length,
    upcoming: c.filter((x) => x.status === "upcoming").length,
    renewals: c.filter((x) => x.renewsIndex !== null).length,
    visitsDone: c.reduce((s, x) => s + x.visits.filter((v) => v.state === "done").length, 0),
    visitsPlanned: c.reduce((s, x) => s + x.visits.filter((v) => v.state === "planned").length, 0),
    clients: new Set(c.map((x) => x.customer.ref?.replace(/[^a-z0-9]/gi, "").toUpperCase() || x.customer.name.toUpperCase())).size,
    withIssues: c.filter((x) => x.issues.length).length,
    rowsLeftOut: parsed.problems.length,
  };
}
