import type {
  AmcFormData,
  AmcService,
  AmcServiceRow,
  PropertyCategory,
  UnitType,
} from "./amc-types";
import { getDefaultEndDateFromStart } from "./amc-date-utils";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";



// TODO(pricing): team to fill unit rates from pricing sheet — all default to 0 until then.
export const AMC_SERVICES: AmcService[] = [
  {
    id: "helpdesk",
    label: "24/7 Technical Support Hotline",
    scope: "24/7 Technical Support Hotline",
    reference: "Clause 1.1",
    frequencyType: "covered",
    /*
      No unit rate, and in every contract (Behrouz, Oct 2026). It is the
      number on the front of the brochure, not a line item: the form used
      to refuse to submit until somebody typed a price for it, and the
      only honest price was 0.
    */
    includedFree: true,
    villaOnly: false,
    hasScopeSection: false,
  },
  {
    id: "ac-ppm",
    label: "AC Planned Preventive Maintenance",
    scope: "Planned Preventive Maintenance ~ Air conditioning service",
    reference: "Clause 2.1",
    frequencyType: "ppm",
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
    villaOnly: false,
    hasScopeSection: false,
  },
  {
    id: "non-emergency",
    label: "Non-Emergency Call-out",
    scope: "Free Non-Emergency Call-out",
    reference: "Clause 3.2",
    /*
      FR4.3 — was "unlimited", which made the frequency uneditable and
      printed "Unlimited". But the clause itself always spoke of "the number
      of free non-emergency visits per year" -- it was the package that
      supplied that number. With packages gone the team enters it, so this
      is a counted service like any other. Emergency call-outs stay
      unlimited; the FRD only changes non-emergency.
    */
    frequencyType: "fixed",
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
  /* As on the current AMC document design (Le Majilis, 2025). */
  address:
    "Gold & Diamond Park, Building 6, Al Quoz, Al Quoz Industrial Area 3, Dubai",
  contractType: "ANNUAL – MEP",
};

/*
  generateProposalNumber() is gone. It built AMC-{year}-{random 1000-9999}
  in the browser with no uniqueness check: 9,000 values a year, so a
  collision became more likely than not at about 112 proposals, and the
  number is the customer-facing reference. amc_proposal_number_seq
  allocates it inside the INSERT instead.
*/

/*
  Which unit types belong to each property category (Behrouz, Oct 2026).

  An office is commercial and a villa is not, but the picker offered all
  three whatever the category -- and the pair prints as the document's own
  banner, so "RESIDENTIAL - OFFICE" was one stray click from the client.

  Kept here rather than in the step because the same pairing decides which
  services are offered, and two lists of unit types would drift.
*/
export const UNIT_TYPES_BY_CATEGORY = {
  residential: [
    { value: "villa", label: "Villa" },
    { value: "apartment", label: "Apartment" },
  ],
  commercial: [{ value: "office", label: "Office" }],
} as const satisfies Record<
  PropertyCategory,
  ReadonlyArray<{ value: UnitType; label: string }>
>;

export function unitTypesForCategory(
  category: PropertyCategory,
): ReadonlyArray<{ value: UnitType; label: string }> {
  return UNIT_TYPES_BY_CATEGORY[category] ?? UNIT_TYPES_BY_CATEGORY.residential;
}

export function getServicesForUnitType(unitType: string) {
  return AMC_SERVICES.filter(
    (service) => !service.villaOnly || unitType === "villa",
  );
}

/*
  FR2.3: the default frequency now comes from the service itself. It used
  to come from the selected package -- which is why a frequency edited to
  5 still printed as 1 per year (FR4.2): the package kept overwriting it.

  Services that declare frequencyPerYear supply their own default. PPM and
  handyman rows do not declare one, because the package used to, so they
  start at 1 and the team enters the real figure. See OQ-6 in the phase 1
  report if the catalogue should carry standing defaults instead.
*/
export function getDefaultFrequencyForService(serviceId: string): number {
  const service = AMC_SERVICES.find((item) => item.id === serviceId);
  return service?.frequencyPerYear ?? 1;
}

export function isFrequencyEditable(frequencyType: AmcService["frequencyType"]) {
  return frequencyType === "ppm" || frequencyType === "handyman" || frequencyType === "fixed";
}

export function buildDefaultServiceRows(
  unitType: AmcFormData["unitType"],
): AmcServiceRow[] {
  return getServicesForUnitType(unitType).map((service) => ({
    serviceId: service.id,
    /*
      A service that is free and in every contract starts ticked. The
      24/7 hotline is the only one today; ticking it by hand on every
      proposal was a step with no decision in it.
    */
    included: service.includedFree === true,
    units: 1,
    frequency: getDefaultFrequencyForService(service.id),
    free: service.includedFree === true,
    // FR2.4: entered per proposal. Undefined rather than 0 -- the team
    // has to type a figure, and "free" has to be typed as 0 on purpose
    // (FR2.12), which an implicit 0 would hide.
    basePrice: undefined,
  }));
}

export function getDefaultEndDate(startDate: string): string {
  return getDefaultEndDateFromStart(startDate);
}

export function emptyPriceListRow() {
  return { category: "", description: "", brand: "", price: "" };
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
    serviceRows: buildDefaultServiceRows(unitType),
    discountPercent: 0,
    /* FR4.5: both off by default. A section only prints when the team
       deliberately switches it on, which is the whole point -- these used
       to print unconditionally with XXX rows in them. */
    optionalSections: {
      supplyInstallPriceList: false,
      additionalFixedPriceServices: false,
    },
    priceListRows: [emptyPriceListRow(), emptyPriceListRow(), emptyPriceListRow()],
    accountManagers: [
      { name: "", phone: "" },
      { name: "", phone: "" },
    ],
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
    /* Allocated by the server on first save -- see generateProposalNumber
       below for why the browser no longer invents one. */
    proposalNumber: "",
  };
}

export function getDefaultSelectedServices() {
  return [...DEFAULT_SERVICE_IDS];
}

/**
 * Who can use AMC Proposals: admins, and anyone whose role has the AMC
 * Proposals permission (view or approve) in role settings. The same rule
 * in the browser (the Extensions menu) and on the server (every AMC route).
 */
export function canUseAmc(user: Parameters<typeof hasResourceAction>[0]): boolean {
  return (
    hasResourceAction(user, ResourceType.AMC, ActionType.VIEW) ||
    hasResourceAction(user, ResourceType.AMC, ActionType.APPROVE) ||
    /* AMC operations staff reach the contract screens too. */
    hasResourceAction(user, ResourceType.AMC_OPERATIONS, ActionType.VIEW) ||
    hasResourceAction(user, ResourceType.AMC_OPERATIONS, ActionType.EDIT) ||
    /* BRD v0.3 6.7: any of the AMC role permissions opens the module. */
    AMC_MODULE_RESOURCES.some((resource) => hasResourceAction(user, resource, ActionType.VIEW))
  );
}

/** The AMC permission areas added for BRD v0.3 (Phase 1). */
export const AMC_MODULE_RESOURCES = [
  ResourceType.AMC_ENQUIRIES,
  ResourceType.AMC_RATE_CARD,
  ResourceType.AMC_CONFIG,
  ResourceType.AMC_PAYMENTS,
  ResourceType.AMC_VISITS,
  ResourceType.AMC_ALLOWANCES,
] as const;

/** Who may open AMC configuration (DEV-419): admins and AMC Configuration View. */
export function canViewAmcConfig(user: Parameters<typeof hasResourceAction>[0]): boolean {
  return hasResourceAction(user, ResourceType.AMC_CONFIG, ActionType.VIEW);
}

/* The sidebar's AMC sections, gated as their API routes are, so nobody is
   shown a menu entry that only answers "Forbidden". */
export function canViewAmcEnquiries(user: Parameters<typeof hasResourceAction>[0]): boolean {
  return hasResourceAction(user, ResourceType.AMC_ENQUIRIES, ActionType.VIEW);
}

export function canViewAmcRateCard(user: Parameters<typeof hasResourceAction>[0]): boolean {
  return hasResourceAction(user, ResourceType.AMC_RATE_CARD, ActionType.VIEW);
}

/* Finance's payments views (Phase 7), gated as /api/amc-payments is. */
export function canViewAmcPayments(user: Parameters<typeof hasResourceAction>[0]): boolean {
  return hasResourceAction(user, ResourceType.AMC_PAYMENTS, ActionType.VIEW);
}

/* The visit board (Phase 9), gated as /api/amc-board is. */
export function canViewAmcVisits(user: Parameters<typeof hasResourceAction>[0]): boolean {
  return hasResourceAction(user, ResourceType.AMC_VISITS, ActionType.VIEW);
}
