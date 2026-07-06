import { addYears, format } from "date-fns";

import {
  AMC_PACKAGES,
  AMC_SERVICES,
  getServicesForUnitType,
} from "./amc-constants";
import type {
  AmcComputedData,
  AmcFormData,
  AmcService,
  FrequencyRow,
} from "./amc-types";
import { amountToWordsAed } from "./utils/amount-to-words";

const VAT_RATE = 0.05;

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

function getMonthlyPrice(data: AmcFormData): number {
  if (data.propertyCategory === "commercial") {
    return data.customMonthlyPrice ?? 0;
  }
  const pkg = AMC_PACKAGES.find((item) => item.id === data.packageId);
  return pkg?.monthlyPrice ?? 0;
}

function getPackageName(data: AmcFormData): string {
  if (data.propertyCategory === "commercial") {
    return "COMMERCIAL";
  }
  const pkg = AMC_PACKAGES.find((item) => item.id === data.packageId);
  return pkg?.name.toUpperCase() ?? "CUSTOM";
}

function getServiceFrequency(service: AmcService, data: AmcFormData): string {
  const manual = data.serviceFrequencies?.[service.id];
  if (manual?.trim()) {
    return manual.trim();
  }

  const pkg = AMC_PACKAGES.find((item) => item.id === data.packageId);
  const ppmVisits =
    data.propertyCategory === "commercial" ? 0 : (pkg?.ppmVisitsPerYear ?? 0);
  const handymanHours =
    data.propertyCategory === "commercial"
      ? 0
      : (pkg?.handymanHoursPerYear ?? 0);

  switch (service.frequencyType) {
    case "covered":
      return "Covered";
    case "unlimited":
      return "Unlimited";
    case "ppm":
      return ppmVisits > 0 ? `${ppmVisits} per year` : "";
    case "handyman":
      return handymanHours > 0
        ? `${handymanHours} hours per year`
        : "";
    case "fixed":
      return `${service.frequencyPerYear ?? 1} per year`;
    default:
      return "Included";
  }
}

export function buildDefaultFrequencyForService(
  serviceId: string,
  data: Pick<AmcFormData, "packageId" | "propertyCategory">
): string {
  const service = AMC_SERVICES.find((item) => item.id === serviceId);
  if (!service) return "";

  const pkg = AMC_PACKAGES.find((item) => item.id === data.packageId);
  const ppmVisits =
    data.propertyCategory === "commercial" ? 0 : (pkg?.ppmVisitsPerYear ?? 0);
  const handymanHours =
    data.propertyCategory === "commercial"
      ? 0
      : (pkg?.handymanHoursPerYear ?? 0);

  switch (service.frequencyType) {
    case "covered":
      return "Covered";
    case "unlimited":
      return "Unlimited";
    case "ppm":
      return ppmVisits > 0 ? `${ppmVisits} per year` : "";
    case "handyman":
      return handymanHours > 0 ? `${handymanHours} hours per year` : "";
    case "fixed":
      return `${service.frequencyPerYear ?? 1} per year`;
    default:
      return "";
  }
}

export function buildFrequenciesForServices(
  serviceIds: string[],
  data: Pick<AmcFormData, "packageId" | "propertyCategory">
): Record<string, string> {
  return serviceIds.reduce<Record<string, string>>((acc, serviceId) => {
    acc[serviceId] = buildDefaultFrequencyForService(serviceId, data);
    return acc;
  }, {});
}

function buildFrequencyRows(data: AmcFormData): FrequencyRow[] {
  const allowedIds = new Set(
    getServicesForUnitType(data.unitType).map((service) => service.id)
  );

  return data.selectedServices
    .filter((id) => allowedIds.has(id))
    .map((id) => AMC_SERVICES.find((service) => service.id === id))
    .filter((service): service is AmcService => Boolean(service))
    .map((service) => ({
      scope: service.scope,
      frequency: getServiceFrequency(service, data),
      reference: service.reference,
    }));
}

export function calculateAmcTotals(data: AmcFormData) {
  const monthlyPrice = getMonthlyPrice(data);
  const annualSubtotal = monthlyPrice * 12;
  const vatAmount = annualSubtotal * VAT_RATE;
  const grandTotal = annualSubtotal + vatAmount;

  return {
    monthlyPrice,
    annualSubtotal,
    vatAmount,
    grandTotal,
    amountInWords: amountToWordsAed(grandTotal),
  };
}

export function computeAmcData(data: AmcFormData): AmcComputedData {
  const packageName = getPackageName(data);
  const categoryLabel =
    data.propertyCategory === "residential" ? "RESIDENTIAL" : "COMMERCIAL";
  const endDate = data.startDate
    ? format(addYears(new Date(data.startDate), 1), "dd/MM/yyyy")
    : "";

  return {
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

export function formatPaymentTermsLabel(
  terms: AmcFormData["paymentTerms"]
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
  designation: AmcFormData["coordinationContacts"][0]["designation"]
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
  data: AmcFormData
): string {
  const service = AMC_SERVICES.find((item) => item.id === serviceId);
  if (!service) return "";
  return getServiceFrequency(service, data);
}
