import type {
  AmcFormData,
  AmcService,
  AmcServiceRow,
  PropertyCategory,
  UnitType,
} from "./amc-types";
import { getDefaultEndDateFromStart } from "./amc-date-utils";
import { AMC_SCOPE_LIBRARY } from "./amc-scope-library";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";



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
  /*
    The Scope of Works Library (Rev. 01, Oct 2026): 33 services in seven
    groups, each with its own clause under clause 2 of the contract --
    the two call-outs included, whose old clause 3 then prints nothing.
    The services the catalogue already had keep their ids, so a saved
    proposal still finds its rows.
  */
  ...AMC_SCOPE_LIBRARY.map((entry): AmcService => {
    return {
      id: entry.id,
      label: entry.label,
      scope: entry.label,
      reference: "Clause",
      frequencyType: entry.frequencyType,
      ...(entry.frequencyPerYear !== undefined ? { frequencyPerYear: entry.frequencyPerYear } : {}),
      villaOnly: entry.unitTypes?.length === 1 && entry.unitTypes[0] === "villa",
      ...(entry.unitTypes ? { unitTypes: entry.unitTypes } : {}),
      sectionTitle: entry.title,
      hasScopeSection: true,
      ref: entry.ref,
      category: entry.category,
      unitOfMeasure: entry.unitOfMeasure,
      ...(entry.frequencySuffix ? { frequencySuffix: entry.frequencySuffix } : {}),
    };
  }),
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
  return AMC_SERVICES.filter((service) =>
    // The list wins where it is set, as it does in AMC Settings.
    service.unitTypes?.length
      ? service.unitTypes.includes(unitType as UnitType)
      : !service.villaOnly || unitType === "villa",
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
  return (
    frequencyType === "ppm" ||
    frequencyType === "handyman" ||
    frequencyType === "fixed" ||
    frequencyType === "weekly" ||
    frequencyType === "manpower"
  );
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
    fixedPriceRates: [],
    clauseOverrides: {},
    scopeOverrides: {},
    accountManagers: [
      { name: "", phone: "" },
      { name: "", phone: "" },
    ],
    customerName: "",
    customerId: "",
    customerPhone: "",
    customerEmail: "",
    // One to start with; the form adds more (AMC-099).
    coordinationContacts: [{ name: "", phone: "", designation: "owner" }],
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
    hasResourceAction(user, ResourceType.AMC, ActionType.APPROVE)
  );
}
