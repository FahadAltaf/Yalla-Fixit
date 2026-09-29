import { formatCurrencyAED } from "@/utils/format-currency";

import { buildAmcBrochure, type AmcBrochure } from "./amc-brochure";
import { AMC_PROVIDER } from "./amc-constants";
import { formatPhoneForDocument } from "./amc-phone";
import { servicesForProperty } from "./amc-settings";
import {
  buildClause1Operation,
  buildPriceListRows,
  fillAmcTokens,
  getSelectedScopeSections,
  stripListMarker,
  textBlocks,
} from "./amc-contract-content";
import {
  formatDesignationLabel,
  formatDisplayDate,
  formatPaymentTermsLabel,
} from "./amc-pricing";
import type { AmcComputedData } from "./amc-types";

/**
 * What an AMC document says, separate from how it is drawn.
 *
 * Both documents are built here as a flat list of blocks — banner, heading,
 * table, bullets and so on — from the proposal's own data and the AMC
 * Settings text (FR6.2, frozen per document by FR6.4). Two renderers draw
 * the same list: templates/AmcDocumentBody.tsx for the screen and the PDF,
 * and amc-docx.ts for Word. Deciding the content once means the PDF and the
 * Word file can never disagree about a clause, a price or a date.
 *
 * The look follows the "Le Majilis" Word design: a red section banner,
 * red-headed tables with striped rows, numbered headings with a red number.
 */

export type Tone = "default" | "muted" | "brand" | "white";

export type Run = { text: string; bold?: boolean; tone?: Tone };

export type Cell = {
  /* Each line is its own paragraph inside the cell. */
  lines: Run[][];
  /* brand = red header, label = grey label column, zebra = striped row. */
  shade?: "brand" | "label" | "zebra";
  align?: "left" | "center" | "right";
  /* Photos shown under the text, two to a row (quotation line items). */
  images?: string[];
};

export type Block =
  | { kind: "contactStrip" }
  | { kind: "banner"; text: string }
  | { kind: "meta"; items: { label: string; value: string }[] }
  | { kind: "label"; text: string }
  | {
      kind: "table";
      widths: number[];
      header?: Cell[];
      rows: Cell[][];
      /* Percent of the page width, set to the right — a totals box. */
      width?: number;
    }
  | { kind: "heading"; number: string; text: string }
  | { kind: "subheading"; number?: string; text: string }
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "bullets"; items: Run[][] }
  | { kind: "numbered"; items: { number: string; runs: Run[] }[] }
  | { kind: "term"; number: string; runs: Run[] }
  | { kind: "signatures"; left: string; right: string };

export type AmcDocumentModel = {
  documentType?: string;
  /* A proposal: the client's brochure with their plan, and nothing after it. */
  brochure?: AmcBrochure;
  blocks: Block[];
};

/* The company as it prints in the footer and the provider details. */
export const AMC_FOOTER = {
  address: "Building 6, Gold & Diamond Park, Al Quoz Industrial Area 3, Dubai, UAE",
  phone: "Tel. +971 800 7373328",
  hotline: "800-PERFECT",
} as const;

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

export const t = (text: string, extra: Omit<Run, "text"> = {}): Run => ({ text, ...extra });

export const cell = (
  lines: Run[][] | Run[] | string,
  extra: Omit<Cell, "lines"> = {},
): Cell => ({
  lines:
    typeof lines === "string"
      ? [[t(lines)]]
      : Array.isArray(lines[0])
        ? (lines as Run[][])
        : [lines as Run[]],
  ...extra,
});

export const headerCell = (text: string, align: Cell["align"] = "left"): Cell =>
  cell([[t(text, { bold: true, tone: "white" })]], { shade: "brand", align });

/* A label/value pair inside one cell: "P.O. Box:  392481". */
export const labelled = (label: string, value: string): Run[] => [
  t(`${label}  `, { bold: true, tone: "muted" }),
  t(value || "—"),
];

/* Striped rows, as in the Word file: every second row is shaded. */
export function zebra(rows: Cell[][]): Cell[][] {
  return rows.map((row, index) =>
    index % 2 === 1
      ? row.map((c) => (c.shade ? c : { ...c, shade: "zebra" as const }))
      : row,
  );
}

/* A two-column details table: grey label column, value column. */
export function detailsTable(rows: [string, Run[] | string][]): Block {
  return {
    kind: "table",
    widths: [28, 72],
    rows: rows.map(([label, value]) => [
      cell([[t(label, { bold: true })]], { shade: "label" }),
      cell(typeof value === "string" ? [[t(value || "—")]] : [value]),
    ]),
  };
}

/* Blank-line separated settings text, with this proposal's figures in. */
function fillBlocks(value: string, data: AmcComputedData): string[] {
  return textBlocks(fillAmcTokens(value ?? "", data.formData.serviceRows));
}

/* "21,100.00" — the Word design's number style. */
export const amount = (value: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bCid\b/g, "CID")
    .replace(/\bIban\b/g, "IBAN")
    .replace(/\bSwift\b/g, "SWIFT");
}

// ---------------------------------------------------------------------------
// Shared opening: contact strip, banner, date/number line
// ---------------------------------------------------------------------------

function opening(data: AmcComputedData): Block[] {
  const noun = data.documentType === "contract" ? "Contract" : "Proposal";
  return [
    { kind: "contactStrip" },
    { kind: "banner", text: data.documentTitle },
    {
      kind: "meta",
      items: [
        { label: `AMC ${noun} Date:`, value: data.proposalDate },
        { label: `AMC ${noun} Number:`, value: data.formData.proposalNumber || "—" },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

/*
  A proposal is its first page alone: the client's brochure with the plan
  they chose (amc-brochure.ts), and no pages after it (2026-09-28). The
  client asked for the brochure to show only what was chosen and what it
  covers; the details table, commercial offer, notes and signature pages
  that used to follow it went at the same time.
*/

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

function contractBlocks(data: AmcComputedData): Block[] {
  const { formData, totals, frequencyRows, settings } = data;
  const fill = (value: string) => fillBlocks(value, data);
  const selectedIds = formData.serviceRows.filter((r) => r.included).map((r) => r.serviceId);

  /* Parties */
  const customerEmails = [formData.customerEmail].filter(Boolean);
  const parties: Block = {
    kind: "table",
    widths: [50, 50],
    header: [headerCell("SERVICE PROVIDER DETAILS"), headerCell("CUSTOMER DETAILS")],
    rows: zebra([
      [
        cell([[t(titleCase(AMC_PROVIDER.companyName), { bold: true })]]),
        cell([[t(formData.customerName || "—", { bold: true })]]),
      ],
      [cell(labelled("P.O. Box:", settings.provider.poBox)), cell(labelled("Customer ID:", formData.customerId))],
      [
        cell(labelled("Contact No:", settings.provider.contactNo)),
        cell(labelled("Contract Type:", settings.provider.contractType)),
      ],
      [cell(labelled("Email:", settings.provider.email)), cell(labelled("Contact No:", formatPhoneForDocument(formData.customerPhone)))],
      [
        cell([
          [t("Coordination Email Address:", { bold: true, tone: "muted" })],
          ...settings.provider.coordinationEmails.filter(Boolean).map((email) => [t(email)]),
        ]),
        cell([
          [t("Email Address:", { bold: true, tone: "muted" })],
          ...(customerEmails.length ? customerEmails.map((email) => [t(email)]) : [[t("—")]]),
        ]),
      ],
      [
        cell([[t("Company Address:", { bold: true, tone: "muted" })], [t(settings.provider.address)]]),
        cell([[t("Customer Address:", { bold: true, tone: "muted" })], [t(formData.propertyAddress || "—")]]),
      ],
    ]),
  };

  const details = detailsTable([
    ["Property Detail", formData.propertyDetail || formData.propertyAddress || "—"],
    ["Property Type", data.propertyTypeLabel],
    ["Period of Service", [t("1 Year Only", { bold: true, tone: "brand" })]],
    [
      "Contract Term",
      [
        t("Starting from  "),
        t(formatDisplayDate(formData.startDate) || "—", { bold: true, tone: "brand" }),
        t("        Expiration  "),
        t(data.endDate || "—", { bold: true, tone: "brand" }),
      ],
    ],
    [
      "Total Amount",
      /* As the Word design states it: the VAT-inclusive total first, then
         how it is made up. */
      [
        t(`${amount(totals.grandTotal)} AED (VAT Inclusive)`, { bold: true, tone: "brand" }),
        t(`   ${amount(totals.finalPrice)} AED + 5% VAT ${amount(totals.vatAmount)} AED`, { tone: "muted" }),
      ],
    ],
    ["Amount in Words", totals.amountInWords],
    ["Terms of Payment", [t(formatPaymentTermsLabel(formData.paymentTerms), { bold: true, tone: "brand" })]],
  ]);

  const contacts = formData.coordinationContacts.filter((c) => c.name?.trim() || c.phone?.trim());
  const contactTable: Block = {
    kind: "table",
    widths: [36, 32, 32],
    header: [headerCell("Name"), headerCell("Phone"), headerCell("Designation")],
    rows: zebra(
      contacts.length
        ? contacts.map((c) => [cell(c.name || "—"), cell(formatPhoneForDocument(c.phone) || "—"), cell(formatDesignationLabel(c.designation))])
        : [[cell("—"), cell("—"), cell("—")]],
    ),
  };

  /*
    The body, built from the clause list (AMC Settings).

    It used to be this function: every heading, every number and every
    section written out in order, so the only thing an admin could change
    was the wording inside one. The list is the order now -- a clause can
    be moved, taken out or added -- and the numbers come from where each
    one sits rather than from the text.
  */
  /* The proposal's closing pages are in the list, but the contract has
     never carried them -- so they take no number here either, which is
     what left a gap where clause 8 should have been. */
  const PROPOSAL_ONLY = new Set(["proposalNotes", "proposalAcceptance"]);
  const priceList = buildPriceListRows(formData.priceListRows ?? []);

  /*
    A clause that prints nothing takes no number with it.

    Two of them draw nothing on most contracts: the price list when it was
    never switched on, and the handyman rates when no rate is written. They
    were numbered first and dropped afterwards, so the number each had
    taken stayed empty -- which is how a contract came to run 6.1, 6.3 with
    no 6.2 anywhere. Deciding it here, before anything is numbered, is what
    makes the sequence answer for itself.

    Asked of the clause rather than of its drawn content because content
    needs the number this decides -- so it reads the same conditions the
    drawing does, and the two are checked against each other below.
  */
  const drawsNothing = (clause: { role?: string; body?: string }): boolean => {
    if (clause.role === "priceListIntro") {
      if (!formData.optionalSections?.supplyInstallPriceList) return true;
      /* The first block is the heading; what follows is the content. */
      return fill(clause.body ?? "").length <= 1 && priceList.length === 0;
    }
    if (clause.role === "handymanRates") {
      return fill(clause.body ?? "").length <= 1;
    }
    return false;
  };

  const clauses = settings.clauseList.filter(
    (clause) =>
      clause.enabled !== false &&
      !(clause.role && PROPOSAL_ONLY.has(clause.role)) &&
      !drawsNothing(clause),
  );
  /*
    The scopes this contract prints, from AMC Settings.

    A service is a setting now, so its scope comes from there too -- and a
    service somebody added carries its own, which is what makes it appear
    in the contract at all. The shipped sections are still the fallback
    for a service whose scope has never been written.
  */
  const shipped = new Map(
    getSelectedScopeSections(selectedIds).map((section) => [section.serviceId, section]),
  );
  const sections = servicesForProperty(settings, formData.unitType)
    .filter(
      (service) =>
        service.hasScopeSection !== false && selectedIds.includes(service.id),
    )
    .map((service) => {
      const fallback = shipped.get(service.id);
      return {
        serviceId: service.id,
        sectionNumber: fallback?.sectionNumber ?? "",
        title: service.sectionTitle ?? fallback?.title ?? `${service.label}:`,
        intro: fallback?.intro,
        bullets: fallback?.bullets ?? [],
      };
    });

  /*
    Pass one: what each clause is numbered.

    Done before anything is drawn because clauses refer to each other --
    "as per definition of emergency on Clause No 3.1" -- and a reference
    has to survive the clause it points at being moved.
  */
  type Numbered = { clause: (typeof clauses)[number]; number: string; subFrom: number };
  const numbered: Numbered[] = [];
  const numberOf = new Map<string, string>();
  let major = 0;
  let minor = 0;
  for (const clause of clauses) {
    let number: string;
    if (clause.level === 1) {
      major += 1;
      minor = 0;
      number = String(major);
    } else {
      minor += 1;
      number = `${major}.${minor}`;
    }
    let subFrom = minor;
    /*
      The services are the sub-clauses: one number each, and the clauses
      after them carry on from where the services end. The clause that
      holds them is not a line of its own.
    */
    if (clause.role === "scopeServices") {
      subFrom = minor;
      minor += Math.max(0, sections.length - 1);
      number = `${major}.${subFrom}`;
    }
    numbered.push({ clause, number, subFrom });
    numberOf.set(clause.id, number);
    if (clause.role) numberOf.set(clause.role, number);
  }

  /* A reference to a clause that has been removed says so, rather than
     printing a number that is now somebody else's. */
  const refText = (value: string) =>
    value.replace(/\{\{clause:([A-Za-z]+)\}\}/g, (_, role: string) => numberOf.get(role) ?? "—");
  const fillRef = (value: string) => fill(value).map(refText);

  /* 2 — the services, numbered under the scope clause they sit in. The
     6.1 table's REFERENCE column follows these numbers. */
  const renumber = new Map<string, string>();

  const scopeBlocks = (startAt: number, parent: string): Block[] => {
    const out: Block[] = [];
    sections.forEach((section, index) => {
      const number = `${parent}.${startAt + index}`;
      renumber.set(section.serviceId, number);
      const row = formData.serviceRows.find((r) => r.serviceId === section.serviceId);
      const units = row?.units ?? 1;
      const title = `${section.title.replace(/:\s*$/, "")}: ${units} ${units === 1 ? "Unit" : "Units"}`;
      /* FR6.2 — the scope text comes from AMC Settings. When the built-in
         section has an intro, the first block is that intro. */
      const text = settings.serviceScopes[section.serviceId];
      const blocks = text === undefined ? null : fill(text);
      const intro = blocks ? (section.intro ? blocks[0] : undefined) : section.intro;
      const bullets = blocks ? (section.intro ? blocks.slice(1) : blocks) : section.bullets;
      out.push({ kind: "subheading", number, text: title });
      if (intro) out.push({ kind: "paragraph", runs: [t(refText(intro))] });
      if (bullets.length) out.push({ kind: "bullets", items: bullets.map((b) => [t(refText(b))]) });
    });
    return out;
  };

  /* 1.1 — the call-out lines are built from the proposal, not typed. */
  const clause1 = buildClause1Operation({
    accountManagers: formData.accountManagers ?? [],
    helpdeskIncluded: selectedIds.includes("helpdesk"),
    serviceRows: formData.serviceRows,
    text: settings.clauses,
  });
  type Section = { paragraphs?: string[]; bullets?: string[]; listItems?: string[] };
  const [s11, s12, s13] = clause1.sections as Section[];

  /*
    What the frequency table's REFERENCE column points at.

    By service, not by the number the scope used to carry: the scopes are
    numbered by where they sit now, and a service somebody added never had
    an old number to rewrite.
  */
  const referenceFor = (row: { serviceId: string; reference: string }) => {
    const number = renumber.get(row.serviceId);
    if (!number) {
      return row.reference.replace(/2\.\d+/, (n) => renumber.get(n) ?? n);
    }
    /* Only the number moves; the word in front of it is the reference's
       own ("Clause 2.1"), and a service added today has none yet. */
    const prefix = row.reference.replace(/\s*\d+(\.\d+)?\s*$/, "").trim();
    return `${prefix || "Clause"} ${number}`;
  };

  const invoiceTerms = fillRef(settings.clauses.invoiceTerms);

  /*
    What a clause is called in the document.

    Three of them have never used a fixed title: 6.1 names the contract it
    belongs to, and 6.2 and 6.3 take their heading from the first line of
    their own text, which is where an admin edits it.
  */
  const headingOf = ({ clause }: Numbered): string => {
    if (clause.role === "servicesTable") {
      return `Scope of work and frequency of the services of the annual maintenance contract (${data.documentTitle}).`;
    }
    if (clause.role === "priceListIntro" || clause.role === "handymanRates") {
      const [first] = fillRef(clause.body);
      if (first) {
        return clause.role === "priceListIntro" ? first.replace(/\.$/, "") : first;
      }
    }
    return clause.title;
  };

  /* What a clause draws beneath its own heading. */
  const contentOf = ({ clause, number, subFrom }: Numbered): Block[] => {
    switch (clause.role) {
      case "helpdeskScheduling":
        return [
          ...(s11.paragraphs ?? []).map((p): Block => ({ kind: "paragraph", runs: [t(refText(p))] })),
          ...(s11.listItems?.length
            ? [
                {
                  kind: "numbered",
                  items: s11.listItems.map((item, index) => ({
                    number: `${number}.${index + 1}`,
                    runs: [t(refText(item))],
                  })),
                } as Block,
              ]
            : []),
        ];
      case "maintenanceTeam":
        return [{ kind: "bullets", items: (s12.bullets ?? []).map((b) => [t(refText(b))]) }];
      case "workingHours":
        return [{ kind: "bullets", items: (s13.paragraphs ?? []).map((p) => [t(refText(p))]) }];
      case "scopeIntro":
        return fillRef(clause.body).map((line): Block => ({ kind: "paragraph", runs: [t(line)] }));
      case "scopeServices":
        return scopeBlocks(subFrom, String(major === 0 ? 1 : number.split(".")[0]));
      case "emergencyCallOut":
      case "nonEmergencyCallOut":
      case "termination":
        return [{ kind: "bullets", items: fillRef(clause.body).map((b) => [t(b)]) }];
      case "materials": {
        /* A line ending in ":" introduces the lines after it. */
        const out: Block[] = [];
        let pending: Run[][] = [];
        const flush = () => {
          if (pending.length) out.push({ kind: "bullets", items: pending });
          pending = [];
        };
        for (const line of fillRef(clause.body)) {
          if (/:\s*$/.test(line)) {
            flush();
            out.push({ kind: "subheading", text: line.replace(/:\s*$/, "") });
          } else {
            pending.push([t(line)]);
          }
        }
        flush();
        return out;
      }
      case "servicesExcluded": {
        const [intro, ...rest] = fillRef(clause.body);
        return [
          ...(intro ? [{ kind: "paragraph", runs: [t(intro)] } as Block] : []),
          ...(rest.length ? [{ kind: "bullets", items: rest.map((b) => [t(b)]) } as Block] : []),
        ];
      }
      case "excludedOffer": {
        /* An introduction, the points, and a closing note. */
        const offer = fillRef(clause.body);
        const intro = offer.length > 1 ? offer[0] : undefined;
        const close = offer.length > 2 ? offer[offer.length - 1] : undefined;
        const points = offer.length > 2 ? offer.slice(1, -1) : offer.length === 2 ? offer.slice(1) : offer;
        return [
          ...(intro ? [{ kind: "paragraph", runs: [t(intro)] } as Block] : []),
          ...(points.length ? [{ kind: "bullets", items: points.map((b) => [t(b)]) } as Block] : []),
          ...(close ? [{ kind: "paragraph", runs: [t(close, { tone: "muted" })] } as Block] : []),
        ];
      }
      case "servicesTable":
        /*
          What is covered and how often, without a price per line.

          This table used to carry a PRICE (AED) column, which invited the
          customer to read the contract as a shopping list and argue a line
          at a time. The figure that is actually agreed is the annual
          contract value on the first page, so that is the only price the
          document quotes. The per-service prices are still computed and
          still feed that total -- they are simply not printed here.
        */
        return [
          {
            kind: "table",
            widths: [45, 10, 25, 20],
            header: [
              headerCell("SCOPE OF MAINTENANCE WORKS"),
              headerCell("UNITS", "center"),
              headerCell("FREQUENCY", "center"),
              headerCell("REFERENCE", "center"),
            ],
            rows: zebra(
              frequencyRows.map((row) => [
                cell(row.scope),
                cell(String(row.units), { align: "center" }),
                cell(row.frequency, { align: "center" }),
                cell([[t(referenceFor(row), { tone: "muted" })]], { align: "center" }),
              ]),
            ),
          },
        ];
      case "priceListIntro": {
        if (!formData.optionalSections?.supplyInstallPriceList) return [];
        /* The first block is the title, which the heading already shows. */
        const [, ...intro] = fillRef(clause.body);
        return [
          ...intro.map((line): Block => ({ kind: "paragraph", runs: [t(line)] })),
          ...(priceList.length
            ? [
                {
                  kind: "table",
                  widths: [8, 22, 38, 16, 16],
                  header: [
                    headerCell("No.", "center"),
                    headerCell("Category"),
                    headerCell("Description"),
                    headerCell("Brand"),
                    headerCell("Price (AED)", "right"),
                  ],
                  rows: zebra(
                    priceList.map((row) => [
                      cell(row.no, { align: "center" }),
                      cell(row.category),
                      cell(row.description),
                      cell(row.brand),
                      cell(row.price, { align: "right" }),
                    ]),
                  ),
                } as Block,
              ]
            : []),
        ];
      }
      case "handymanRates": {
        if (!formData.optionalSections?.additionalFixedPriceServices) return [];
        /* The first block is the title; then one rate per block. */
        const [, ...rates] = fillRef(clause.body);
        if (!rates.length) return [];
        /*
          These read "A." and "B." in the wording shipped before, and some
          saved settings still carry those letters. The marker a line was
          typed with is dropped either way and the line takes the number of
          its position under this clause, so the document counts one way
          throughout instead of switching to letters two levels down.
        */
        return [
          {
            kind: "numbered",
            items: rates.map((rate, index) => ({
              number: `${number}.${index + 1}`,
              runs: [t(stripListMarker(rate))],
            })),
          },
        ];
      }
      case "generalTerms": {
        /*
          "7.x text" prints as a numbered term; a line without a number
          continues the term above it.

          The numbers are renumbered from the clause's own, so moving the
          general terms does not leave a section numbered 6 whose terms
          all still read 7.1, 7.2 and so on. In the standard order this
          gives exactly the numbers the text already carries.
        */
        const out: Block[] = [];
        let term = 0;
        for (const line of fillRef(clause.body)) {
          const match = line.match(/^(\d+\.\d+)\s+(.*)$/);
          if (!match) {
            out.push({ kind: "paragraph", runs: [t(line)] });
            continue;
          }
          term += 1;
          const termNumber = `${number}.${term}`;
          if (/^(Modes?|Moods?) of payment/i.test(match[2])) {
            out.push({
              kind: "subheading",
              number: termNumber,
              text: "Modes of Payment (cash, cheque or bank transfer)",
            });
          } else {
            out.push({ kind: "term", number: termNumber, runs: [t(match[2])] });
          }
        }
        return out;
      }
      case "bankDetails":
        return [
          {
            kind: "table",
            widths: [32, 68],
            /* One "Label: value" line per row. */
            rows: zebra(
              fillRef(clause.body).map((line) => {
                const at = line.indexOf(":");
                const label = at > 0 ? line.slice(0, at).trim() : "";
                const value = at > 0 ? line.slice(at + 1).trim() : line;
                return [cell([[t(label, { bold: true })]], { shade: "label" }), cell(value)];
              }),
            ),
          },
        ];
      case "invoiceTerms":
        return [
          {
            kind: "paragraph",
            runs: [
              t("Annual contract value: "),
              t(`${formatCurrencyAED(totals.grandTotal)} (VAT inclusive).`, { bold: true }),
              ...(invoiceTerms[0] ? [t(` ${invoiceTerms[0]}`)] : []),
            ],
          },
          ...invoiceTerms.slice(1).map((line): Block => ({ kind: "paragraph", runs: [t(line)] })),
        ];
      case "contractConfirmation":
        return [
          { kind: "paragraph", runs: [t(refText(clause.body), { bold: true })] },
          { kind: "paragraph", runs: [t("Date:  ____________________________")] },
        ];
      case "signatures":
        return [
          {
            kind: "signatures",
            left: "On behalf of Yalla Fix It LLC",
            right: `On behalf of ${formData.customerName || "the Client"}`,
          },
        ];
      default:
        /* A clause somebody added: its heading, then its text. */
        return fillRef(clause.body).map((line): Block => ({ kind: "paragraph", runs: [t(line)] }));
    }
  };

  /*
    Pass two: the document.

    A heading with nothing under it is still drawn -- it is a section of
    the contract, and the clauses beneath it are its content. The ones
    that draw nothing at all (a price list that was switched off) take
    their heading with them.
  */
  const body: Block[] = [];
  /*
    Kept as a backstop, not as the decision: `drawsNothing` above has
    already left these out of the numbering, so one reaching here empty
    means the two disagree. It is dropped rather than printed as a bare
    heading, and the number it took is the one gap this cannot catch.
  */
  const SILENT_WHEN_EMPTY = new Set(["priceListIntro", "handymanRates", "signatures"]);
  /*
    Clauses that run on from the one above rather than announcing
    themselves: the other services offered continue clause 5, the bank
    table and the invoice terms continue clause 7, the confirmation
    continues clause 8, and the services carry their own numbers.
  */
  const NO_HEADING = new Set([
    "scopeServices",
    "excludedOffer",
    "bankDetails",
    "invoiceTerms",
    "contractConfirmation",
    "signatures",
  ]);
  for (const entry of numbered) {
    const role = entry.clause.role;
    const content = contentOf(entry);
    if (content.length === 0 && role && SILENT_WHEN_EMPTY.has(role)) continue;
    if (!role || !NO_HEADING.has(role)) {
      body.push({
        kind: entry.clause.level === 1 ? "heading" : "subheading",
        number: entry.number,
        text: refText(headingOf(entry)),
      });
    }
    body.push(...content);
  }

  return [
    ...opening(data),
    { kind: "label", text: "BETWEEN:" },
    parties,
    details,
    { kind: "label", text: "Customer Coordination – Contact Persons" },
    contactTable,
    ...body,
  ];
}

export function buildAmcDocumentModel(data: AmcComputedData): AmcDocumentModel {
  if (data.documentType === "contract") {
    return { documentType: data.documentType, blocks: contractBlocks(data) };
  }
  return {
    documentType: data.documentType,
    brochure: buildAmcBrochure(data),
    blocks: [],
  };
}
