import { format } from "date-fns";

import {
  AMC_SERVICES,
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

const VAT_RATE = 0.05;

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

function buildFrequencyRows(data: AmcFormData): FrequencyRow[] {
  const allowedIds = new Set(
    getServicesForUnitType(data.unitType).map((service) => service.id),
  );

  return data.serviceRows
    .filter((row) => row.included && allowedIds.has(row.serviceId))
    .map((row) => {
      const service = AMC_SERVICES.find((item) => item.id === row.serviceId);
      if (!service) return null;
      return {
        scope: service.scope,
        frequency: formatFrequencyForPdf(service, row.frequency),
        reference: service.reference,
      };
    })
    .filter((row): row is FrequencyRow => Boolean(row));
}

export function computeAmcData(
  data: AmcFormData,
  documentType: AmcDocumentType = "proposal",
): AmcComputedData {
  const categoryLabel =
    data.propertyCategory === "residential" ? "RESIDENTIAL" : "COMMERCIAL";
  const endDate = data.endDate ? formatDisplayDate(data.endDate) : "";

  return {
    documentType,
    /* FR4.3: the banner used to read "<PACKAGE> AMC PACKAGE". With
       packages gone it names the document and the property category. */
    documentTitle: `AMC ${documentType === "contract" ? "CONTRACT" : "PROPOSAL"} (${categoryLabel})`,
    propertyTypeLabel: formatPropertyTypeLabel(data),
    proposalDate: format(new Date(), "dd/MM/yyyy"),
    endDate,
    totals: calculateAmcTotals(data),
    frequencyRows: buildFrequencyRows(data),
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
): string {
  const service = AMC_SERVICES.find((item) => item.id === serviceId);
  const row = data.serviceRows.find((item) => item.serviceId === serviceId);
  if (!service || !row) return "";
  return formatFrequencyForPdf(service, row.frequency);
}
