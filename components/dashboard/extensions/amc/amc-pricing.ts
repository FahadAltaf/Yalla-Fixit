import { format } from "date-fns";

import {
  AMC_PACKAGES,
  AMC_SERVICES,
  getDefaultFrequencyForService,
  getServicesForUnitType,
  isFrequencyEditable,
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

export function computeServiceRowPrice(row: AmcServiceRow): number {
  if (!row.included) return 0;
  const service = AMC_SERVICES.find((item) => item.id === row.serviceId);
  if (!service) return 0;
  return service.unitRate * row.units * row.frequency;
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

function getPackageName(data: AmcFormData): string {
  if (data.propertyCategory === "commercial") {
    return "COMMERCIAL";
  }
  const pkg = AMC_PACKAGES.find((item) => item.id === data.packageId);
  return pkg?.name.toUpperCase() ?? "CUSTOM";
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
  const packageName = getPackageName(data);
  const categoryLabel =
    data.propertyCategory === "residential" ? "RESIDENTIAL" : "COMMERCIAL";
  const endDate = data.endDate ? formatDisplayDate(data.endDate) : "";

  return {
    documentType,
    packageName,
    packageTitle: `${packageName} AMC PACKAGE (${categoryLabel})`,
    propertyTypeLabel: formatPropertyTypeLabel(data),
    proposalDate: format(new Date(), "dd/MM/yyyy"),
    endDate,
    totals: calculateAmcTotals(data),
    frequencyRows: buildFrequencyRows(data),
    formData: data,
  };
}

export function refreshServiceRowFrequencies(
  serviceRows: AmcServiceRow[],
  packageId: string | undefined,
  propertyCategory: AmcFormData["propertyCategory"],
): AmcServiceRow[] {
  return serviceRows.map((row) => {
    const service = AMC_SERVICES.find((item) => item.id === row.serviceId);
    if (!service || !isFrequencyEditable(service.frequencyType)) {
      return row;
    }
    return {
      ...row,
      frequency: getDefaultFrequencyForService(
        row.serviceId,
        packageId,
        propertyCategory,
      ),
    };
  });
}

export function syncServiceRowsForUnitType(
  serviceRows: AmcServiceRow[],
  unitType: AmcFormData["unitType"],
  packageId?: string,
  propertyCategory: AmcFormData["propertyCategory"] = "residential",
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
      frequency: getDefaultFrequencyForService(
        service.id,
        packageId,
        propertyCategory,
      ),
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
