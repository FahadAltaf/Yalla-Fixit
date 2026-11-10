import { format } from "date-fns";

import {
  computeAmcPricing,
  grandTotalFromFinal,
  rowPrice,
} from "@/lib/amc/pricing";
import { chargeFrequencyType } from "./amc-constants";
import type {
  AmcComputedData,
  AmcDocumentType,
  AmcFormData,
  AmcService,
  AmcServiceRow,
  AmcTotals,
  FrequencyRow,
} from "./amc-types";
import { UNIT_TYPE_LABELS } from "@/lib/amc/client-profile";
import { paymentPlanLabel } from "@/lib/amc/proposal-rules";

import { isCustomServiceRow } from "./amc-types";
import { contractTermMonths } from "./amc-date-utils";
import { amountToWordsAed } from "./utils/amount-to-words";
import {
  AMC_CLAUSE_TEXT_ROLES,
  getAmcSettingsDefaults,
  servicesForProperty,
} from "./amc-settings";
import type { AmcClauseTextRole, AmcServiceDefinition, AmcSettings } from "./amc-settings";

/**
 * A service's name with the equipment it covers, as the documents print
 * it: "A/C Preventive Maintenance (10 FCU)" (DEV-261). The name alone
 * when no equipment was entered.
 */
export function withEquipment(name: string, equipment: string | null | undefined): string {
  const covered = equipment?.trim();
  return covered ? `${name} (${covered})` : name;
}

/**
 * The VAT-inclusive total, from the figure a submission stores.
 *
 * A submission stores `final_price`, which is the annual fee BEFORE VAT.
 * The proposal, the contract and the detail page all quote the grand
 * total, which is that plus VAT, so a list showing one price per
 * submission has to do this sum rather than print what it was given.
 * Printing the stored figure under a heading like "Final price" is how a
 * proposal came to read 3,500 in the list and 3,675 on its own page.
 */
export function grandTotalOf(finalPriceExclVat: number): number {
  return grandTotalFromFinal(finalPriceExclVat);
}

/*
  FR2.5: Price = Base Price x Units x Frequency, read only, recomputed on
  every change. The base price is entered per proposal (FR2.4) and
  replaces the unitRate constant, which was never filled in and made
  every document price at zero.

  A missing base price contributes 0 rather than NaN, so a half-filled
  table still shows a running subtotal. FR2.12 blocks submission until
  every checked row has one.
*/
export function computeServiceRowPrice(row: AmcServiceRow): number {
  return rowPrice(priceableRow(row));
}

/*
  A row as lib/amc/pricing.ts prices it: with its service's frequency type,
  which decides how many times a year the base price is charged (Scope of
  Works Library: a pool is serviced so many times a WEEK, a deployed cleaner
  is priced per person per MONTH). A service added to the proposal alone
  (DEV-260) is a fixed number of visits a year.
*/
export function priceableRow<T extends { serviceId: string }>(row: T): T & { frequencyType: string | null } {
  return { ...row, frequencyType: chargeFrequencyType(row.serviceId) };
}

/*
  Totals come from lib/amc/pricing.ts, the same code the API uses to set
  final_price, so the wizard, the documents and the stored figure agree
  to the fil. See that file for the rounding rule.
*/
export function calculateAmcTotals(data: AmcFormData): AmcTotals {
  /*
    Monthly is divided by the term, not by twelve (client, Oct 2026): a
    six-month contract quoted a monthly figure half what the client pays,
    because the divisor was hard-coded to a year. The dates decide it.
  */
  const termMonths = contractTermMonths(data.startDate, data.endDate);
  const pricing = computeAmcPricing(data.serviceRows.map(priceableRow), data.discountPercent ?? 0, termMonths);

  return {
    subtotal: pricing.subtotal,
    discountPercent: pricing.discountPercent,
    discountAmount: pricing.discountAmount,
    finalPrice: pricing.finalPrice,
    termMonths,
    monthlyPrice: pricing.monthlyPrice,
    annualSubtotal: pricing.finalPrice,
    vatAmount: pricing.vatAmount,
    grandTotal: pricing.grandTotal,
    amountInWords: amountToWordsAed(pricing.grandTotal),
  };
}

function formatPropertyTypeLabel(data: AmcFormData): string {
  const category =
    data.propertyCategory === "residential" ? "RESIDENTIAL" : "COMMERCIAL";
  /* The full property type when the proposal has one (Phase 4). */
  if (data.propertyType) return `${category} - ${UNIT_TYPE_LABELS[data.propertyType].toUpperCase()}`;
  const unit =
    data.unitType === "villa"
      ? "VILLA"
      : data.unitType === "apartment"
        ? "APARTMENT"
        : "OFFICE";
  return `${category} - ${unit}`;
}

function formatFrequencyForPdf(
  service: Pick<AmcService, "frequencyType" | "frequencySuffix">,
  frequency: number,
): string {
  // As the Scope of Works Library writes them: "4 times per year + call-backs".
  const suffix = service.frequencySuffix ?? "";
  switch (service.frequencyType) {
    case "covered":
      return "Covered";
    case "unlimited":
      return "Unlimited";
    case "handyman":
      return `${frequency} hours per year`;
    case "weekly":
      return `${frequency} ${frequency === 1 ? "visit" : "visits"} per week${suffix}`;
    case "manpower":
      return `Daily (${frequency} days per week)${suffix}`;
    case "ppm":
    case "fixed":
    default:
      // In the Service Summary's own words: once, twice, monthly.
      if (frequency === 1) return `Once per year${suffix}`;
      if (frequency === 2) return `Twice per year${suffix}`;
      if (frequency === 12) return `Monthly (12 times per year)${suffix}`;
      return `${frequency} times per year${suffix}`;
  }
}

/*
  The services on this proposal, priced.

  Taken from AMC Settings, which is where they live now: a service added
  there has to reach the frequency table, the proposal's list and the
  contract's scope, and reading them from three places is how those three
  drift apart.
*/
function buildFrequencyRows(data: AmcFormData, settings: AmcSettings): FrequencyRow[] {
  const offered = servicesForProperty(settings, data.unitType);
  const allowedIds = new Set(offered.map((service) => service.id));
  const byId = new Map(offered.map((service) => [service.id, service]));

  return data.serviceRows
    .filter((row) => row.included && allowedIds.has(row.serviceId))
    .map((row) => {
      const service = byId.get(row.serviceId);
      if (!service) return null;
      return {
        serviceId: service.id,
        scope: service.scope,
        units: row.units,
        /*
          A hotline has no units, and an hourly handyman allowance is
          measured in hours rather than in things. The services that do
          have a unit count are exactly the ones that print a scope of
          work of their own: the AC, the pumps, the tanks, the ducts.
        */
        hasUnits:
          service.hasScopeSection === true &&
          service.frequencyType !== "handyman" &&
          // A call-out is not counted in units, even with a scope section of its own.
          service.frequencyType !== "unlimited" &&
          service.frequencyType !== "covered",
        frequency: formatFrequencyForPdf(service, row.frequency),
        price: computeServiceRowPrice(row),
        reference: service.reference,
        equipment: row.equipment?.trim() ?? "",
        unitOfMeasure: service.unitOfMeasure ?? "",
      };
    })
    .filter((row): row is FrequencyRow => Boolean(row));
}

function offeredRowsOnly(data: AmcFormData, settings: AmcSettings): AmcServiceRow[] {
  const offered = new Set(
    servicesForProperty(settings, data.unitType).map((service) => service.id),
  );
  return data.serviceRows.filter(
    (row) => !row.included || offered.has(row.serviceId) || isCustomServiceRow(row),
  );
}

/*
  The services this proposal can print: AMC Settings' own, plus any the
  team added to this proposal alone (DEV-260).

  A custom service is given the shape of a settings service -- a fixed
  number of visits a year, a scope section of its own, offered on every
  kind of property -- with its scope text beside the others. Done once
  here, so the frequency table, the contract's clauses and the proposal's
  list all find it the way they find any other service.
*/
export function withProposalServices(settings: AmcSettings, data: Pick<AmcFormData, "serviceRows">): AmcSettings {
  const custom = data.serviceRows.filter(isCustomServiceRow);
  if (custom.length === 0) return settings;
  const name = (row: AmcServiceRow) => row.customName?.trim() || "Additional service";
  return {
    ...settings,
    services: [
      ...settings.services,
      ...custom.map((row) => ({
        id: row.serviceId,
        label: name(row),
        scope: name(row),
        sectionTitle: name(row),
        frequencyType: "fixed" as const,
        villaOnly: false,
        hasScopeSection: true,
        reference: "Clause",
        enabled: true,
      })),
    ],
    serviceScopes: {
      ...settings.serviceScopes,
      /* One point per line as typed; the contract reads points as
         blank-line separated blocks. */
      ...Object.fromEntries(
        custom.map((row) => [
          row.serviceId,
          (row.customScope ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join("\n\n"),
        ]),
      ),
    },
  };
}

/*
  The contract's wording as this proposal has it (DEV-263): AMC Settings'
  text, with any clause or service scope the team edited on this proposal
  put in its place. The settings themselves are never touched, so the
  default stays what it was for every other proposal.

  Placeholders such as {{handymanHours}} survive the edit and are still
  filled from the service table when the document is built, which is
  what keeps an edited clause from contradicting the table.
*/
export function withProposalWording(
  settings: AmcSettings,
  data: Pick<AmcFormData, "clauseOverrides" | "scopeOverrides">,
): AmcSettings {
  const clauseOverrides = data.clauseOverrides ?? {};
  const scopeOverrides = data.scopeOverrides ?? {};
  if (Object.keys(clauseOverrides).length === 0 && Object.keys(scopeOverrides).length === 0) {
    return settings;
  }
  const textRoles = new Set<string>(AMC_CLAUSE_TEXT_ROLES);
  const clauses = { ...settings.clauses };
  const clauseList = settings.clauseList.map((clause) => {
    const body = clauseOverrides[clause.id];
    if (typeof body !== "string") return clause;
    // The builder reads some clauses by role, so the role's copy follows.
    if (clause.role && textRoles.has(clause.role)) {
      clauses[clause.role as AmcClauseTextRole] = body;
    }
    return { ...clause, body };
  });
  return {
    ...settings,
    clauseList,
    clauses,
    serviceScopes: { ...settings.serviceScopes, ...scopeOverrides },
  };
}

export function computeAmcData(
  data: AmcFormData,
  documentType: AmcDocumentType = "proposal",
  /* FR6.4: a sent proposal passes its snapshot; a draft passes live
     settings; a caller that has neither gets the shipped defaults. */
  settings: AmcSettings = getAmcSettingsDefaults(),
  /* The date the document was sent, once it has been. A draft prints
     today's date, since that is the day it would go out. */
  documentDate?: string | null,
): AmcComputedData {
  const categoryLabel =
    data.propertyCategory === "residential" ? "RESIDENTIAL" : "COMMERCIAL";
  const endDate = data.endDate ? formatDisplayDate(data.endDate) : "";
  settings = withProposalServices(withProposalWording(settings, data), data);

  return {
    documentType,
    settings,
    /* FR4.3: the banner used to read "<PACKAGE> AMC PACKAGE". With
       packages gone it names the document and the property category. */
    documentTitle: `AMC ${documentType === "contract" ? "CONTRACT" : "PROPOSAL"} (${categoryLabel})`,
    propertyTypeLabel: formatPropertyTypeLabel(data),
    proposalDate: format(
      documentDate ? new Date(documentDate) : new Date(),
      "dd/MM/yyyy",
    ),
    endDate,
    /* Totals over the same rows the documents list: a ticked service the
       settings in force do not offer is neither printed nor charged. */
    totals: calculateAmcTotals({
      ...data,
      serviceRows: offeredRowsOnly(data, settings),
    }),
    frequencyRows: buildFrequencyRows(data, settings),
    formData: data,
  };
}

/*
  refreshServiceRowFrequencies is gone with the packages (FR2.6). It
  existed to push package visit counts back over the table whenever the
  package changed -- which is exactly the behaviour FR4.2 reports as a
  bug: a frequency edited to 5 was reset behind the team's back.
*/

/*
  The rows a proposal can have: one per service AMC Settings offers on
  this kind of property, in Settings' order. Settings is the catalogue for
  new and draft proposals; sent ones render from their snapshot instead.

  A row the team already filled in is kept as it is. A service that is not
  offered any more (switched off in Settings, or not offered on this kind
  of property) has its row dropped, so it can no longer be charged; its
  id is reported back so the wizard can say so. A new row starts at the
  service's own default frequency from Settings.
*/
export function syncServiceRowsForUnitType(
  serviceRows: AmcServiceRow[],
  unitType: AmcFormData["unitType"],
  catalogue: ReadonlyArray<AmcServiceDefinition> = getAmcSettingsDefaults().services,
): { rows: AmcServiceRow[]; removedIncluded: string[] } {
  const offered = servicesForProperty({ services: [...catalogue] }, unitType);
  const offeredIds = new Set(offered.map((service) => service.id));
  const existingById = new Map(serviceRows.map((row) => [row.serviceId, row]));

  const rows = offered.map((service) => {
    const existing = existingById.get(service.id);
    if (existing) return existing;
    return {
      serviceId: service.id,
      included: service.includedFree === true,
      units: 1,
      frequency: defaultFrequencyFor(service),
      free: service.includedFree === true,
      basePrice: undefined,
    };
  })
    // Custom services are offered on every kind of property, so they stay (DEV-260).
    .concat(serviceRows.filter(isCustomServiceRow));

  const removedIncluded = serviceRows
    .filter((row) => row.included && !offeredIds.has(row.serviceId) && !isCustomServiceRow(row))
    .map((row) => row.serviceId);

  return { rows, removedIncluded };
}

/** Where a new row's frequency starts: the service's own figure, else 1. */
export function defaultFrequencyFor(
  service: Pick<AmcServiceDefinition, "frequencyType" | "frequencyPerYear">,
): number {
  if (service.frequencyType === "covered" || service.frequencyType === "unlimited") {
    return 1;
  }
  const value = service.frequencyPerYear;
  return value && Number.isInteger(value) && value >= 1 ? value : 1;
}

/** How the proposal is paid, as the documents print it: the plan when it has one, else its legacy terms. */
export function formatPaymentLabel(
  data: Pick<AmcFormData, "paymentTerms" | "paymentPlan" | "paymentPlanCustom">,
  /* The legacy "Annual" reads "Upfront" off a 12-month term (main, Oct 2026). */
  termMonths = 12,
): string {
  return data.paymentPlan ? paymentPlanLabel(data.paymentPlan, data.paymentPlanCustom ?? null) : formatPaymentTermsLabel(data.paymentTerms, termMonths);
}

export function formatPaymentTermsLabel(
  terms: AmcFormData["paymentTerms"],
  /* "Annual" is one payment for the whole term; on a shorter or longer
     term it is called what it is. */
  termMonths = 12,
): string {
  switch (terms) {
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annual":
      return termMonths === 12 ? "Annual" : "Upfront";
    default:
      return "TBD";
  }
}

/*
  A contact's designation as the contract prints it: the three usual ones
  by their label, anything the client calls them as typed (AMC-099), all in
  the contract's capitals.
*/
export function formatDesignationLabel(designation: string | null | undefined): string {
  const value = (designation ?? "").trim();
  switch (value) {
    case "owner":
      return "OWNER";
    case "tenant":
      return "TENANT";
    case "representative":
      return "REPRESENTATIVE";
    default:
      return value ? value.toUpperCase() : "—";
  }
}

export function formatDisplayDate(isoDate: string): string {
  if (!isoDate) return "";
  return format(new Date(isoDate), "dd/MM/yyyy");
}

export function getServiceFrequencyLabel(
  serviceId: string,
  data: AmcFormData,
  settings: AmcSettings = getAmcSettingsDefaults(),
): string {
  const service = settings.services.find((item) => item.id === serviceId);
  const row = data.serviceRows.find((item) => item.serviceId === serviceId);
  if (!service || !row) return "";
  return formatFrequencyForPdf(service, row.frequency);
}
