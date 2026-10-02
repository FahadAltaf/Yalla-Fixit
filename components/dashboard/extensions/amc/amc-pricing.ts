import { format } from "date-fns";

import {
  getDefaultFrequencyForService,
  getServicesForUnitType,
} from "./amc-constants";
import type {
  AmcComputedData,
  AmcDocumentType,
  AmcFormData,
  AmcService,
  AmcServiceRow,
  AmcTotals,
  FrequencyRow,
} from "./amc-types";
import { amountToWordsAed } from "./utils/amount-to-words";
import { getAmcSettingsDefaults, servicesForProperty } from "./amc-settings";
import type { AmcSettings } from "./amc-settings";

const VAT_RATE = 0.05;

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
  return finalPriceExclVat * (1 + VAT_RATE);
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
  if (!row.included) return 0;
  return (row.basePrice ?? 0) * row.units * row.frequency;
}

export function calculateAmcTotals(data: AmcFormData): AmcTotals {
  const subtotal = data.serviceRows.reduce(
    (sum, row) => sum + computeServiceRowPrice(row),
    0,
  );
  const discountPercent = data.discountPercent ?? 0;
  const discountAmount = subtotal * (discountPercent / 100);
  const finalPrice = subtotal - discountAmount;
  const vatAmount = finalPrice * VAT_RATE;
  const grandTotal = finalPrice + vatAmount;
  const monthlyPrice = finalPrice / 12;

  return {
    subtotal,
    discountPercent,
    discountAmount,
    finalPrice,
    monthlyPrice,
    annualSubtotal: finalPrice,
    vatAmount,
    grandTotal,
    amountInWords: amountToWordsAed(grandTotal),
  };
}

function formatPropertyTypeLabel(data: AmcFormData): string {
  const category =
    data.propertyCategory === "residential" ? "RESIDENTIAL" : "COMMERCIAL";
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
        frequency: formatFrequencyForPdf(service, row.frequency),
        price: computeServiceRowPrice(row),
        reference: service.reference,
      };
    })
    .filter((row): row is FrequencyRow => Boolean(row));
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
    totals: calculateAmcTotals(data),
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

export function syncServiceRowsForUnitType(
  serviceRows: AmcServiceRow[],
  unitType: AmcFormData["unitType"],
): AmcServiceRow[] {
  const allowedServices = getServicesForUnitType(unitType);
  const allowedIds = new Set(allowedServices.map((service) => service.id));
  const existingById = new Map(serviceRows.map((row) => [row.serviceId, row]));

  return allowedServices.map((service) => {
    const existing = existingById.get(service.id);
    if (existing) {
      return existing.included ? existing : { ...existing, included: false };
    }
    return {
      serviceId: service.id,
      included: false,
      units: 1,
      frequency: getDefaultFrequencyForService(service.id),
      basePrice: undefined,
    };
  }).filter((row) => allowedIds.has(row.serviceId));
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
