import { formatCurrencyAED } from "@/utils/format-currency";

import { AMC_PROVIDER } from "./amc-constants";
import { formatPhoneForDocument } from "./amc-phone";
import {
  buildClause1Operation,
  buildPriceListRows,
  fillAmcTokens,
  getSelectedScopeSections,
  textBlocks,
} from "./amc-contract-content";
import {
  formatDesignationLabel,
  formatDisplayDate,
  formatPaymentTermsLabel,
} from "./amc-pricing";
import {
  buildProposalCommercialTerms,
  buildProposalServiceRows,
  formatProposalFee,
  getProposalContactPerson,
  getProposalCoverageMonths,
  getProposalPropertyLabel,
  getProposalStartLabel,
} from "./amc-proposal-content";
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
  | { kind: "lettered"; items: { letter: string; runs: Run[] }[] }
  | { kind: "term"; number: string; runs: Run[] }
  | { kind: "signatures"; left: string; right: string };

export type AmcDocumentModel = {
  documentType?: string;
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
  What each service covers, for the proposal's Services table: every point
  from AMC Settings, the same text the contract prints for the service, so
  an edit there reaches both documents. One point prints as a sentence,
  several as a bulleted list.
*/
function proposalCoverage(data: AmcComputedData, serviceId: string): Run[][] {
  const text = data.settings.serviceScopes[serviceId];
  const points = text !== undefined ? fillBlocks(text, data) : [];
  if (!points.length) return [[t("—", { tone: "muted" })]];
  return points.map((point) => [t(points.length > 1 ? `• ${point}` : point)]);
}

function proposalBlocks(data: AmcComputedData): Block[] {
  const { formData, totals, frequencyRows } = data;
  const services = buildProposalServiceRows(formData, frequencyRows);
  const terms = buildProposalCommercialTerms(formData, data.settings.provider);

  return [
    ...opening(data),
    detailsTable([
      ["Prepared For", [t(formData.customerName || "—", { bold: true })]],
      ["Property", getProposalPropertyLabel(formData)],
      ["Property Type", data.propertyTypeLabel],
      ["Contact Person", getProposalContactPerson(formData)],
      ["Contract Start", getProposalStartLabel(formData)],
      [
        "Coverage",
        [t(`${getProposalCoverageMonths(formData)} Months`, { bold: true, tone: "brand" })],
      ],
      ["Validity", data.settings.provider.proposalValidity],
    ]),

    { kind: "heading", number: "1", text: "Services Included" },
    {
      kind: "table",
      widths: [20, 37, 8, 14, 21],
      header: [
        headerCell("Service"),
        headerCell("Coverage"),
        headerCell("Units", "center"),
        headerCell("Frequency", "center"),
        headerCell("Price (AED)", "right"),
      ],
      rows: zebra(
        services.length
          ? services.map((row) => [
              cell([[t(row.service, { bold: true })]]),
              cell(proposalCoverage(data, row.serviceId)),
              cell(String(row.units), { align: "center" }),
              cell(row.frequency, { align: "center" }),
              cell(formatCurrencyAED(row.price), { align: "right" }),
            ])
          : [[cell("No services selected."), cell(""), cell(""), cell(""), cell("")]],
      ),
    },

    { kind: "heading", number: "2", text: "Commercial Offer" },
    detailsTable([
      [
        "Annual Maintenance Contract Fee",
        [
          t(`AED ${formatProposalFee(totals.finalPrice)}`, { bold: true, tone: "brand" }),
          t("  (Excluding 5% VAT)", { tone: "muted" }),
        ],
      ],
      ...terms.map((term): [string, string] => [term.label, term.value]),
    ]),

    { kind: "heading", number: "3", text: "Important Notes" },
    { kind: "bullets", items: fillBlocks(data.settings.clauses.proposalNotes, data).map((note) => [t(note)]) },

    { kind: "heading", number: "4", text: "Client Acceptance" },
    {
      kind: "paragraph",
      runs: [t(data.settings.clauses.proposalAcceptance, { bold: true })],
    },
    { kind: "paragraph", runs: [t("Date:  ____________________________")] },
    {
      kind: "signatures",
      left: "On behalf of Yalla Fix It LLC",
      right: `On behalf of ${formData.customerName || "the Client"}`,
    },
  ];
}

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

  /* 1 — Operation, from AMC Settings (1.1–1.3) */
  const clause1 = buildClause1Operation({
    accountManagers: formData.accountManagers ?? [],
    helpdeskIncluded: selectedIds.includes("helpdesk"),
    serviceRows: formData.serviceRows,
    text: settings.clauses,
  });
  type Section = { paragraphs?: string[]; bullets?: string[]; listItems?: string[] };
  const [s11, s12, s13] = clause1.sections as Section[];
  const operation: Block[] = [
    { kind: "heading", number: "1", text: "Operation" },
    { kind: "subheading", number: "1.1", text: "Helpdesk and Scheduling" },
    ...(s11.paragraphs ?? []).map((p): Block => ({ kind: "paragraph", runs: [t(p)] })),
    ...(s11.listItems?.length
      ? [
          {
            kind: "lettered",
            items: s11.listItems.map((item, index) => ({
              letter: `${String.fromCharCode(65 + index)}.`,
              runs: [t(item)],
            })),
          } as Block,
        ]
      : []),
    { kind: "subheading", number: "1.2", text: "Maintenance Team" },
    { kind: "bullets", items: (s12.bullets ?? []).map((b) => [t(b)]) },
    { kind: "subheading", number: "1.3", text: "Working Hours" },
    { kind: "bullets", items: (s13.paragraphs ?? []).map((p) => [t(p)]) },
  ];

  /* 2 — Scope of works. Only the services on this contract, numbered
     2.1, 2.2 … in order — the catalogue numbers left gaps when a service
     was not selected, and the 6.1 table references follow the new numbers. */
  const sections = getSelectedScopeSections(selectedIds);
  const renumber = new Map<string, string>();
  const scope: Block[] = [
    { kind: "heading", number: "2", text: "Scope of Works" },
    ...fill(settings.clauses.scopeIntro).map((line): Block => ({ kind: "paragraph", runs: [t(line)] })),
  ];
  sections.forEach((section, index) => {
    const number = `2.${index + 1}`;
    renumber.set(section.sectionNumber, number);
    const row = formData.serviceRows.find((r) => r.serviceId === section.serviceId);
    const units = row?.units ?? 1;
    const title = `${section.title.replace(/:\s*$/, "")}: ${units} ${units === 1 ? "Unit" : "Units"}`;
    /* FR6.2 — the scope text comes from AMC Settings. When the built-in
       section has an intro, the first block is that intro. */
    const text = settings.serviceScopes[section.serviceId];
    const blocks = text === undefined ? null : fill(text);
    const intro = blocks ? (section.intro ? blocks[0] : undefined) : section.intro;
    const bullets = blocks ? (section.intro ? blocks.slice(1) : blocks) : section.bullets;
    scope.push({ kind: "subheading", number, text: title });
    if (intro) scope.push({ kind: "paragraph", runs: [t(intro)] });
    if (bullets.length) scope.push({ kind: "bullets", items: bullets.map((b) => [t(b)]) });
  });

  /* 3 — Call-outs, from AMC Settings */
  const callOuts: Block[] = [
    { kind: "heading", number: "3", text: "Emergency & Non-Emergency Call-Out" },
    { kind: "subheading", number: "3.1", text: "Emergency Call-Out" },
    { kind: "bullets", items: fill(settings.clauses.emergencyCallOut).map((b) => [t(b)]) },
    { kind: "subheading", number: "3.2", text: "Non-Emergency Call-Out" },
    { kind: "bullets", items: fill(settings.clauses.nonEmergencyCallOut).map((b) => [t(b)]) },
  ];

  /* 4 — Materials. A line ending in ":" introduces the lines after it. */
  const materials: Block[] = [
    { kind: "heading", number: "4", text: "Materials, Spare Parts, Consumables & Labor" },
  ];
  let pending: Run[][] = [];
  const flush = () => {
    if (pending.length) materials.push({ kind: "bullets", items: pending });
    pending = [];
  };
  for (const line of fill(settings.clauses.materials)) {
    if (/:\s*$/.test(line)) {
      flush();
      materials.push({ kind: "subheading", text: line.replace(/:\s*$/, "") });
    } else {
      pending.push([t(line)]);
    }
  }
  flush();

  /* 5 — Services excluded: first block is the intro (from AMC Settings). */
  const [excludedIntro, ...excluded] = fill(settings.clauses.servicesExcluded);
  /* The other services offered: an introduction, the points, and a
     closing note (AMC Settings). */
  const offer = fill(settings.clauses.excludedOffer);
  const offerIntro = offer.length > 1 ? offer[0] : undefined;
  const offerClose = offer.length > 2 ? offer[offer.length - 1] : undefined;
  const offerPoints = offer.length > 2 ? offer.slice(1, -1) : offer.length === 2 ? offer.slice(1) : offer;
  const exclusions: Block[] = [
    { kind: "heading", number: "5", text: "Services Excluded" },
    ...(excludedIntro ? [{ kind: "paragraph", runs: [t(excludedIntro)] } as Block] : []),
    ...(excluded.length ? [{ kind: "bullets", items: excluded.map((b) => [t(b)]) } as Block] : []),
    ...(offerIntro ? [{ kind: "paragraph", runs: [t(offerIntro)] } as Block] : []),
    ...(offerPoints.length ? [{ kind: "bullets", items: offerPoints.map((b) => [t(b)]) } as Block] : []),
    ...(offerClose ? [{ kind: "paragraph", runs: [t(offerClose, { tone: "muted" })] } as Block] : []),
  ];

  /* 6 — Frequency table, price list, fixed-price handyman */
  const referenceFor = (reference: string) =>
    reference.replace(/2\.\d+/, (n) => renumber.get(n) ?? n);
  const frequency: Block[] = [
    { kind: "heading", number: "6", text: "Service Frequency & Provisions" },
    {
      kind: "subheading",
      number: "6.1",
      text: `Scope of work and frequency of the services of the annual maintenance contract (${data.documentTitle}).`,
    },
    {
      kind: "table",
      widths: [36, 8, 17, 22, 17],
      header: [
        headerCell("SCOPE OF MAINTENANCE WORKS"),
        headerCell("UNITS", "center"),
        headerCell("FREQUENCY", "center"),
        headerCell("PRICE (AED)", "right"),
        headerCell("REFERENCE", "center"),
      ],
      rows: zebra(
        frequencyRows.map((row) => [
          cell(row.scope),
          cell(String(row.units), { align: "center" }),
          cell(row.frequency, { align: "center" }),
          cell(formatCurrencyAED(row.price), { align: "right" }),
          cell([[t(referenceFor(row.reference), { tone: "muted" })]], { align: "center" }),
        ]),
      ),
    },
  ];

  const priceList = buildPriceListRows(formData.priceListRows ?? []);
  if (formData.optionalSections?.supplyInstallPriceList) {
    /* From AMC Settings: the first block is the title. */
    const [title, ...intro] = fill(settings.clauses.priceListIntro);
    if (title) frequency.push({ kind: "subheading", number: "6.2", text: title.replace(/\.$/, "") });
    frequency.push(...intro.map((line): Block => ({ kind: "paragraph", runs: [t(line)] })));
    if (priceList.length) {
      frequency.push({
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
      });
    }
  }
  if (formData.optionalSections?.additionalFixedPriceServices) {
    /* From AMC Settings: the first block is the title, then one rate per
       block. A rate that starts "A." keeps its letter; one that does not
       is lettered in order. */
    const [rateTitle, ...rates] = fill(settings.clauses.handymanRates);
    if (rateTitle) frequency.push({ kind: "subheading", number: "6.3", text: rateTitle });
    if (rates.length) {
      frequency.push({
        kind: "lettered",
        items: rates.map((rate, index) => {
          const match = rate.match(/^([A-Z])[.)]\s*(.*)$/);
          return match
            ? { letter: `${match[1]}.`, runs: [t(match[2])] }
            : { letter: `${String.fromCharCode(65 + index)}.`, runs: [t(rate)] };
        }),
      });
    }
  }

  /* 7 — General terms. "7.x text" prints with a red number; a line with
     no number continues the term above it. */
  const invoiceTerms = fill(settings.clauses.invoiceTerms);
  const terms: Block[] = [{ kind: "heading", number: "7", text: "General Terms and Conditions and Payment" }];
  for (const line of fill(settings.clauses.generalTerms)) {
    const match = line.match(/^(7\.\d+)\s+(.*)$/);
    if (!match) {
      terms.push({ kind: "paragraph", runs: [t(line)] });
    } else if (/^(Modes?|Moods?) of payment/i.test(match[2])) {
      terms.push({ kind: "subheading", number: match[1], text: "Modes of Payment (cash, cheque or bank transfer)" });
    } else {
      terms.push({ kind: "term", number: match[1], runs: [t(match[2])] });
    }
  }
  terms.push(
    {
      kind: "table",
      widths: [32, 68],
      /* From AMC Settings: one "Label: value" line per row. */
      rows: zebra(
        fill(settings.clauses.bankDetails).map((line) => {
          const at = line.indexOf(":");
          const label = at > 0 ? line.slice(0, at).trim() : "";
          const value = at > 0 ? line.slice(at + 1).trim() : line;
          return [cell([[t(label, { bold: true })]], { shade: "label" }), cell(value)];
        }),
      ),
    },
    {
      kind: "paragraph",
      runs: [
        t("Annual contract value: "),
        t(`${formatCurrencyAED(totals.grandTotal)} (VAT inclusive).`, { bold: true }),
        ...(invoiceTerms[0] ? [t(` ${invoiceTerms[0]}`)] : []),
      ],
    },
    ...invoiceTerms.slice(1).map((line): Block => ({ kind: "paragraph", runs: [t(line)] })),
  );

  /* 8 — Termination, from AMC Settings */
  const termination: Block[] = [
    { kind: "heading", number: "8", text: "Termination" },
    { kind: "bullets", items: fill(settings.clauses.termination).map((b) => [t(b)]) },
    { kind: "paragraph", runs: [t(settings.clauses.contractConfirmation, { bold: true })] },
    { kind: "paragraph", runs: [t("Date:  ____________________________")] },
    {
      kind: "signatures",
      left: "On behalf of Yalla Fix It LLC",
      right: `On behalf of ${formData.customerName || "the Client"}`,
    },
  ];

  return [
    ...opening(data),
    { kind: "label", text: "BETWEEN:" },
    parties,
    details,
    { kind: "label", text: "Customer Coordination – Contact Persons" },
    contactTable,
    ...operation,
    ...scope,
    ...callOuts,
    ...materials,
    ...exclusions,
    ...frequency,
    ...terms,
    ...termination,
  ];
}

export function buildAmcDocumentModel(data: AmcComputedData): AmcDocumentModel {
  return {
    documentType: data.documentType,
    blocks: data.documentType === "contract" ? contractBlocks(data) : proposalBlocks(data),
  };
}
