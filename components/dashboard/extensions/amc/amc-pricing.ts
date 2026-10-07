import { format } from "date-fns";

import {
  computeAmcPricing,
  grandTotalFromFinal,
  rowPrice,
} from "@/lib/amc/pricing";
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

import { contractTermMonths } from "./amc-date-utils";
import { amountToWordsAed } from "./utils/amount-to-words";
import { getAmcSettingsDefaults, servicesForProperty } from "./amc-settings";
import type { AmcServiceDefinition, AmcSettings } from "./amc-settings";

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
  // Unticked and "included at no charge" rows are 0 (rowPrice handles
  // both), so the table, the totals and the documents cannot disagree.
  return rowPrice(row);
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
  const pricing = computeAmcPricing(data.serviceRows, data.discountPercent ?? 0, termMonths);

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

function formatFrequencyForPdf(service: AmcService, frequency: number): string {
  switch (service.frequencyType) {
    case "covered":
      return "Covered";
    case "unlimited":
      return "Unlimited";
    case "handyman":
      return `${frequency} hours per year`;
    case "ppm":
    case "fixed":
    default:
      return `${frequency} per year`;
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
          service.hasScopeSection === true && service.frequencyType !== "handyman",
        frequency: formatFrequencyForPdf(service, row.frequency),
        price: computeServiceRowPrice(row),
        reference: service.reference,
      };
    })
    .filter((row): row is FrequencyRow => Boolean(row));
}

function offeredRowsOnly(data: AmcFormData, settings: AmcSettings): AmcServiceRow[] {
  const offered = new Set(
    servicesForProperty(settings, data.unitType).map((service) => service.id),
  );
  return data.serviceRows.filter((row) => !row.included || offered.has(row.serviceId));
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
  });

  const removedIncluded = serviceRows
    .filter((row) => row.included && !offeredIds.has(row.serviceId))
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
export function formatPaymentLabel(data: Pick<AmcFormData, "paymentTerms" | "paymentPlan" | "paymentPlanCustom">): string {
  return data.paymentPlan ? paymentPlanLabel(data.paymentPlan, data.paymentPlanCustom ?? null) : formatPaymentTermsLabel(data.paymentTerms);
}

export function formatPaymentTermsLabel(
  terms: AmcFormData["paymentTerms"],
): string {
  switch (terms) {
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annual":
      return "Annual";
    default:
      return "TBD";
  }
}

export function formatDesignationLabel(
  designation: AmcFormData["coordinationContacts"][0]["designation"],
): string {
  switch (designation) {
    case "owner":
      return "OWNER";
    case "tenant":
      return "TENANT";
    case "representative":
      return "REPRESENTATIVE";
    default:
      return "OWNER";
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
