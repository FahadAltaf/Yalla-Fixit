import type { AmcFormData, AmcPackage, AmcService, AmcServiceRow } from "./amc-types";
import { getDefaultEndDateFromStart } from "./amc-date-utils";

export const AMC_PACKAGES: AmcPackage[] = [
  {
    id: "basic",
    name: "Basic",
    slug: "basic",
    monthlyPrice: 95,
    ppmVisitsPerYear: 1,
    handymanHoursPerYear: 2,
    propertyCategory: "residential",
  },
  {
    id: "basic-plus",
    name: "Basic Plus",
    slug: "basic-plus",
    monthlyPrice: 125,
    ppmVisitsPerYear: 2,
    handymanHoursPerYear: 6,
    propertyCategory: "residential",
  },
  {
    id: "executive",
    name: "Executive",
    slug: "executive",
    monthlyPrice: 200,
    ppmVisitsPerYear: 2,
    handymanHoursPerYear: 12,
    propertyCategory: "residential",
  },
  {
    id: "elite",
    name: "Elite",
    slug: "elite",
    monthlyPrice: 250,
    ppmVisitsPerYear: 3,
    handymanHoursPerYear: 24,
    propertyCategory: "residential",
  },
];

// TODO(pricing): team to fill unit rates from pricing sheet — all default to 0 until then.
export const AMC_SERVICES: AmcService[] = [
  {
    id: "helpdesk",
    label: "24/7 Technical Support Hotline",
    scope: "24/7 Technical Support Hotline",
    reference: "Clause 1.1",
    frequencyType: "covered",
    unitRate: 0,
    villaOnly: false,
    hasScopeSection: false,
  },
  {
    id: "ac-ppm",
    label: "AC Planned Preventive Maintenance",
    scope: "Planned Preventive Maintenance ~ Air conditioning service",
    reference: "Clause 2.1",
    frequencyType: "ppm",
    unitRate: 0,
    villaOnly: false,
    sectionNumber: "2.1",
    sectionTitle: "Air Condition Service and Maintenance (PPM)",
    hasScopeSection: true,
  },
  {
    id: "electrical-ppm",
    label: "Electrical PPM",
    scope: "Planned Preventive Maintenance ~ Electrical Service",
    reference: "Clause 2.2",
    frequencyType: "ppm",
    unitRate: 0,
    villaOnly: false,
    sectionNumber: "2.2",
    sectionTitle: "Electrical Service and Maintenance (PPM)",
    hasScopeSection: true,
  },
  {
    id: "plumbing-ppm",
    label: "Plumbing PPM",
    scope: "Planned Preventive Maintenance ~ Plumbing Service",
    reference: "Clause 2.3",
    frequencyType: "ppm",
    unitRate: 0,
    villaOnly: false,
    sectionNumber: "2.3",
    sectionTitle: "Plumbing Service and Maintenance",
    hasScopeSection: true,
  },
  {
    id: "water-pump",
    label: "Water Pump Maintenance",
    scope: "Planned Preventive Maintenance ~ Water Pump Service",
    reference: "Clause 2.4",
    frequencyType: "fixed",
    frequencyPerYear: 1,
    unitRate: 0,
    villaOnly: true,
    sectionNumber: "2.4",
    sectionTitle: "Water Pump Maintenance",
    hasScopeSection: true,
  },
  {
    id: "roof-drain",
    label: "Roof Drain Cleaning",
    scope: "Roof drain cleaning",
    reference: "Clause 2.5",
    frequencyType: "fixed",
    frequencyPerYear: 1,
    unitRate: 0,
    villaOnly: true,
    sectionNumber: "2.5",
    sectionTitle: "Roof Drain cleaning",
    hasScopeSection: true,
  },
  {
    id: "water-tank",
    label: "Water Tank Cleaning",
    scope: "Water tank cleaning and disinfection",
    reference: "Clause 2.6",
    frequencyType: "fixed",
    frequencyPerYear: 2,
    unitRate: 0,
    villaOnly: true,
    sectionNumber: "2.6",
    sectionTitle: "Water tank cleaning",
    hasScopeSection: true,
  },
  {
    id: "duct-cleaning",
    label: "Air Duct Cleaning",
    scope: "Air duct cleaning and sanitization",
    reference: "Clause 2.7",
    frequencyType: "fixed",
    frequencyPerYear: 1,
    unitRate: 0,
    villaOnly: false,
    sectionNumber: "2.7",
    sectionTitle: "Duct cleaning",
    hasScopeSection: true,
  },
  {
    id: "coil-cleaning",
    label: "Evaporator Coil Cleaning",
    scope: "Evaporator coil cleaning",
    reference: "Clause 2.8",
    frequencyType: "fixed",
    frequencyPerYear: 1,
    unitRate: 0,
    villaOnly: false,
    sectionNumber: "2.8",
    sectionTitle: "Coil cleaning",
    hasScopeSection: true,
  },
  {
    id: "handyman",
    label: "Free Handyman Service",
    scope: "Free Handyman service",
    reference: "Clause 2.9",
    frequencyType: "handyman",
    unitRate: 0,
    villaOnly: false,
    sectionNumber: "2.9",
    sectionTitle: "Free Handyman service",
    hasScopeSection: true,
  },
  {
    id: "emergency",
    label: "Emergency Call-out",
    scope: "Free Emergency Call-out / Visit",
    reference: "Clause 3.1",
    frequencyType: "unlimited",
    unitRate: 0,
    villaOnly: false,
    hasScopeSection: false,
  },
  {
    id: "non-emergency",
    label: "Non-Emergency Call-out",
    scope: "Free Non-Emergency Call-out",
    reference: "Clause 3.2",
    frequencyType: "unlimited",
    unitRate: 0,
    villaOnly: false,
    hasScopeSection: false,
  },
];

export const DEFAULT_SERVICE_IDS = [
  "helpdesk",
  "ac-ppm",
  "electrical-ppm",
  "plumbing-ppm",
  "handyman",
  "emergency",
  "non-emergency",
] as const;

export const AMC_PROVIDER = {
  companyName: "YALLA FIX IT ONE PERSON COMPANY LLC",
  poBox: "392481",
  contactNo: "800-PERFECT / 05X XXX XX / 05X XXX XX",
  email: "info@yallafixit.ae",
  coordinationEmails: ["XXX@TPHGROUP.ME", "XXX@TPHGROUP.ME"],
  address:
    "PO Box 392512, Office 102, Commercial Bank of Dubai, Al Quoz Industrial 3 Dubai, UAE",
  contractType: "ANNUAL – MEP",
};

export function generateProposalNumber(): string {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(Math.random() * 9000) + 1000);
  return `AMC-${year}-${suffix}`;
}

export function getServicesForUnitType(unitType: string) {
  return AMC_SERVICES.filter(
    (service) => !service.villaOnly || unitType === "villa",
  );
}

export function getDefaultFrequencyForService(
  serviceId: string,
  packageId?: string,
  propertyCategory: AmcFormData["propertyCategory"] = "residential",
): number {
  const service = AMC_SERVICES.find((item) => item.id === serviceId);
  if (!service) return 1;

  const pkg = AMC_PACKAGES.find((item) => item.id === packageId);
  const ppmVisits =
    propertyCategory === "commercial" ? 0 : (pkg?.ppmVisitsPerYear ?? 1);
  const handymanHours =
    propertyCategory === "commercial" ? 0 : (pkg?.handymanHoursPerYear ?? 1);

  switch (service.frequencyType) {
    case "covered":
    case "unlimited":
      return 1;
    case "ppm":
      return ppmVisits > 0 ? ppmVisits : 1;
    case "handyman":
      return handymanHours > 0 ? handymanHours : 1;
    case "fixed":
      return service.frequencyPerYear ?? 1;
    default:
      return 1;
  }
}

export function isFrequencyEditable(frequencyType: AmcService["frequencyType"]) {
  return frequencyType === "ppm" || frequencyType === "handyman" || frequencyType === "fixed";
}

export function buildDefaultServiceRows(
  unitType: AmcFormData["unitType"],
  packageId?: string,
  propertyCategory: AmcFormData["propertyCategory"] = "residential",
): AmcServiceRow[] {
  return getServicesForUnitType(unitType).map((service) => ({
    serviceId: service.id,
    included: false,
    units: 1,
    frequency: getDefaultFrequencyForService(
      service.id,
      packageId,
      propertyCategory,
    ),
  }));
}

export function getDefaultEndDate(startDate: string): string {
  return getDefaultEndDateFromStart(startDate);
}

export function getDefaultFormValues(): AmcFormData {
  const today = new Date();
  const startDate = today.toISOString().split("T")[0];
  const unitType = "villa" as const;

  return {
    propertyCategory: "residential",
    unitType,
    propertyAddress: "",
    propertyDetail: "",
    packageId: "",
    customMonthlyPrice: undefined,
    serviceRows: buildDefaultServiceRows(unitType),
    discountPercent: 0,
    customerName: "",
    customerId: "",
    customerPhone: "",
    customerEmail: "",
    coordinationContacts: [
      { name: "", phone: "", designation: "owner" },
      { name: "", phone: "", designation: "owner" },
    ],
    startDate,
    endDate: getDefaultEndDate(startDate),
    paymentTerms: "annual",
    proposalNumber: generateProposalNumber(),
  };
}

export function getDefaultSelectedServices() {
  return [...DEFAULT_SERVICE_IDS];
}

const AMC_CONTRACTS_ALLOWED_EMAILS = new Set([
  "sharon.v@tphgroup.me",
  "balochdanish2020@gmail.com",
  "m.bahsas@tphgroup.me",
  "sami.f@tphgroup.me",
  "samifarah2013@gmail.com",
]);

export function canAccessAmcContracts(email?: string | null): boolean {
  if (!email) return false;
  return AMC_CONTRACTS_ALLOWED_EMAILS.has(email.trim().toLowerCase());
}
