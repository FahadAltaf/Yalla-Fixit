import { z } from "zod";

import {
  AMC_BROCHURE_KEYS,
  getAmcBrochureDefaults,
  type AmcBrochureKey,
} from "./amc-brochure-copy";
import { AMC_PROVIDER, AMC_SERVICES } from "./amc-constants";
import {
  BANK_DETAILS,
  CLAUSE_2_INTRO,
  CLAUSE_6_2_INTRO,
  CLAUSE_6_3_HANDYMAN,
  CLAUSE_7_TERMS,
  PROPOSAL_IMPORTANT_NOTES,
  CLAUSE_1_OPERATION,
  CLAUSE_3_EMERGENCY,
  CLAUSE_4_MATERIALS,
  CLAUSE_5_EXCLUDED,
  CLAUSE_8_TERMINATION,
  SCOPE_SECTIONS,
} from "./amc-contract-content";

/**
 * AMC Settings — the standard text and standard values of both documents
 * (FR6.1–FR6.5).
 *
 * The storage model is an OVERRIDE document, not a full copy. The code is
 * the default; `amc_settings.overrides` holds only what an admin has
 * actually edited; `resolveAmcSettings` merges them. Three reasons:
 *
 *   1. FR6.2 covers ~350 lines of clause text that already exists in
 *      amc-contract-content.ts. A second copy in the database would drift
 *      from the first, and the contract would depend on which one the
 *      renderer happened to read.
 *   2. An untouched install renders exactly as it does today, so shipping
 *      this changes nothing until somebody deliberately edits something.
 *   3. A clause the team never edits keeps getting fixes from releases.
 *      Copy it into the database once and it is frozen forever.
 *
 * FR6.4 is the reason `resolveAmcSettings` exists at all: documents render
 * from a submission's frozen snapshot once it has been sent, and from live
 * settings only while it is still a draft.
 */

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/*
  Which clause of the document a record IS.

  Most of the standard clauses are more than a block of text: 2 loops over
  the services on the contract, 6.1 draws the services table, 6.2 the
  price list, 7.16 the bank table. The role is how the builder knows which
  of those to draw; a clause added by an admin has none, and is printed as
  its title and its text.
*/
/* The eighteen that are a block of text, and so are keys of `clauses`. */
export const AMC_CLAUSE_TEXT_ROLES = [
  "helpdeskScheduling",
  "maintenanceTeam",
  "workingHours",
  "scopeIntro",
  "emergencyCallOut",
  "nonEmergencyCallOut",
  "materials",
  "servicesExcluded",
  "excludedOffer",
  "priceListIntro",
  "handymanRates",
  "generalTerms",
  "bankDetails",
  "invoiceTerms",
  "termination",
  "contractConfirmation",
  "proposalNotes",
  "proposalAcceptance",
] as const;

/*
  Clauses that are a structure rather than a paragraph: the services the
  contract covers, the table of their frequencies and prices, and the
  signature block. They have no text to edit, but they are still clauses
  -- they can be moved and taken out like any other.
*/
export const AMC_CLAUSE_STRUCTURE_ROLES = [
  "scopeServices",
  "servicesTable",
  "signatures",
] as const;

export const AMC_CLAUSE_ROLES = [
  ...AMC_CLAUSE_TEXT_ROLES,
  ...AMC_CLAUSE_STRUCTURE_ROLES,
] as const;

export type AmcClauseRole = (typeof AMC_CLAUSE_ROLES)[number];
export type AmcClauseTextRole = (typeof AMC_CLAUSE_TEXT_ROLES)[number];

/**
 * One clause, in the order it prints.
 *
 * The clauses used to be eighteen fixed fields, so an admin could reword
 * one and nothing else: no adding a clause the contract needed, no taking
 * out one it did not, no moving them. They are a list now, and their
 * numbers come from their order rather than being written into the text.
 */
export const amcClauseSchema = z.object({
  /* Stable, so an override and a sent proposal's snapshot still name the
     same clause after it has been moved or retitled. */
  id: z.string().min(1),
  title: z.string(),
  /** Blank-line separated blocks, as every clause body has been. */
  body: z.string(),
  /** 1 numbers as "4"; 2 numbers as "4.2", under the clause above it. */
  level: z.union([z.literal(1), z.literal(2)]).default(1),
  role: z.enum(AMC_CLAUSE_ROLES).optional(),
  /** False leaves it out of the document without losing its text. */
  enabled: z.boolean().default(true),
});

export type AmcClause = z.infer<typeof amcClauseSchema>;

/* The proposal's first page, the client's brochure: one text per field. */
const amcBrochureSchema = z.object(
  Object.fromEntries(AMC_BROCHURE_KEYS.map((key) => [key, z.string()])) as Record<
    AmcBrochureKey,
    z.ZodString
  >,
);

/**
 * One service the contract can cover.
 *
 * The twelve were a list in the code, so a service could not be added
 * without a release -- and a service is not only a line in the proposal:
 * it carries a price, a frequency, whether it is villa-only, and the
 * scope it prints in the contract.
 */
export const amcServiceSchema = z.object({
  id: z.string().min(1),
  /** How it reads in the proposal's list of services. */
  label: z.string(),
  /** How it reads in the contract's frequency table. */
  scope: z.string(),
  /** The heading its scope prints under in the contract. */
  sectionTitle: z.string().optional(),
  /**
   * What goes in the frequency column: a set number of visits a year
   * (ppm), unlimited, covered, a handyman allowance, or a fixed job.
   */
  frequencyType: z.enum(["covered", "unlimited", "ppm", "handyman", "fixed"]),
  /** Where the table starts it (FR2.3); the proposal can change it. */
  frequencyPerYear: z.number().optional(),
  /**
   * Which kinds of property it is offered on. Absent means every kind,
   * which is what most services are.
   *
   * It used to be a villa-only flag, which could say "villas" and nothing
   * else -- there was no way to offer something on offices alone.
   */
  unitTypes: z.array(z.enum(["villa", "apartment", "office"])).optional(),
  /** The flag it replaced; still read from settings saved before it. */
  villaOnly: z.boolean().default(false),
  /** Whether it prints a scope of work of its own in clause 2. */
  hasScopeSection: z.boolean().default(true),
  /** What the frequency table's REFERENCE column points at. */
  reference: z.string().default(""),
  /** False keeps it on file without offering it on new proposals. */
  enabled: z.boolean().default(true),
});

export type AmcServiceDefinition = z.infer<typeof amcServiceSchema>;

export const amcSettingsSchema = z.object({
  /* FR6.3 — standard values. These are the last two §8.2 placeholders:
     they print on every contract and are the same on all of them. */
  provider: z.object({
    contactNo: z.string(),
    coordinationEmails: z.array(z.string()),
    /* The company as it prints in the contract's provider details. */
    poBox: z.string(),
    email: z.string(),
    address: z.string(),
    contractType: z.string(),
    /* Printed in the proposal's commercial offer. */
    standardResponseTime: z.string(),
    emergencyResponseTime: z.string(),
    proposalValidity: z.string(),
  }),
  /*
    FR6.2 — standard text, keyed by clause. Only the clauses the FRD names
    are editable; the rest of the contract stays in code, because making
    every string editable turns a settings page into a word processor
    nobody can safely use.
  */
  clauses: z.object({
    helpdeskScheduling: z.string(),
    maintenanceTeam: z.string(),
    workingHours: z.string(),
    /* 2: the paragraph above the scope of each service. */
    scopeIntro: z.string(),
    emergencyCallOut: z.string(),
    nonEmergencyCallOut: z.string(),
    materials: z.string(),
    servicesExcluded: z.string(),
    /* 5: the other services offered. First block introduces the list, the
       last is the closing note, everything between is a point. */
    excludedOffer: z.string(),
    /* 6.2: the title line, then the paragraphs above the price list. */
    priceListIntro: z.string(),
    /* 6.3: the title line, then one line per rate ("A. First hour ..."). */
    handymanRates: z.string(),
    /* 7: one block per term, numbered "7.1 ...". */
    generalTerms: z.string(),
    /* 7.16: one "Label: value" line per row of the bank table. */
    bankDetails: z.string(),
    /* After the bank table. The first block follows the annual contract
       value on the same line. */
    invoiceTerms: z.string(),
    termination: z.string(),
    /* The line above the contract signatures. */
    contractConfirmation: z.string(),
    /* The proposal's closing notes, one per block. */
    proposalNotes: z.string(),
    /* The line above the proposal signatures. */
    proposalAcceptance: z.string(),
  }),
  /*
    The clauses in order. `clauses` above is this list keyed by role, which
    is what the document builder has always read; both come from here.
  */
  clauseList: z.array(amcClauseSchema),
  /*
    The services on offer, in the order they are listed. Their scope text
    lives in `serviceScopes`, keyed by the same ids.
  */
  services: z.array(amcServiceSchema),
  /* FR6.2 — "the scope of work for each service", keyed by service id. */
  serviceScopes: z.record(z.string(), z.string()),
  /* The wording of the proposal, the client's brochure (amc-brochure-copy.ts). */
  brochure: amcBrochureSchema,
  /*
    FR5.3: who may approve or send back a submitted proposal, by email.
    Empty means the role permission (AMC approve) decides, as before.
  */
  approval: z.object({
    approvers: z.array(z.string()),
  }),
});

export type AmcSettings = z.infer<typeof amcSettingsSchema>;

/* What an admin has changed. Every branch optional, because the stored
   document holds edits only. */
export const amcSettingsOverridesSchema = z
  .object({
    provider: amcSettingsSchema.shape.provider.partial().optional(),
    clauses: amcSettingsSchema.shape.clauses.partial().optional(),
    /*
      The whole list, when an admin has added, removed or moved one --
      there is no merging a list by key. An override saved before the list
      existed carries only `clauses`, and is read into the standard order
      (clauseListFrom).
    */
    clauseList: z.array(amcClauseSchema).optional(),
    /* The whole list, for the same reason the clauses are. */
    services: z.array(amcServiceSchema).optional(),
    serviceScopes: z.record(z.string(), z.string()).optional(),
    brochure: amcBrochureSchema.partial().optional(),
    approval: amcSettingsSchema.shape.approval.partial().optional(),
  })
  .default({});

export type AmcSettingsOverrides = z.infer<typeof amcSettingsOverridesSchema>;

// ---------------------------------------------------------------------------
// Defaults, read from the code that renders today
// ---------------------------------------------------------------------------

function joinLines(...parts: (string | string[] | undefined)[]): string {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : part ? [part] : []))
    .filter(Boolean)
    .join("\n\n");
}

function clause1Section(title: string, key: "paragraphs" | "bullets"): string {
  const section = CLAUSE_1_OPERATION.sections.find(
    (item) => item.title === title,
  ) as { paragraphs?: string[]; bullets?: string[] } | undefined;
  return section ? joinLines(section[key]) : "";
}

function clause3Section(prefix: string): string {
  const section = CLAUSE_3_EMERGENCY.sections.find((item) =>
    item.title.startsWith(prefix),
  );
  return section ? joinLines(section.bullets) : "";
}

/**
 * The shipped text, as the documents render it now. Derived from the
 * existing constants rather than restated, so a release that corrects a
 * clause also corrects the default here.
 */
/*
  The services with no scope section in the contract (the hotline and the
  two call-out services) are described by their own clauses (1.1, 3.1,
  3.2). Their entry here is the short description the proposal's Services
  table prints, editable like every other scope.
*/
const SERVICE_SUMMARY: Record<string, string> = {
  helpdesk:
    "Round-the-clock technical support hotline for maintenance inquiries and coordination.",
  emergency:
    "Priority response for critical failures outside standard working hours and on holidays.",
  "non-emergency":
    "Scheduled inspection and minor rectification visits within agreed working hours.",
};

/*
  The standard clauses, in the order they print, with the title each one
  carries in the contract today. Their text comes from the keyed defaults
  below, so there is still one copy of the wording.
*/
type StandardClause = Omit<AmcClause, "body"> & { role?: AmcClauseRole };

/*
  The contract as it has always printed, now written down rather than
  built into the renderer: its section headings, the clauses under them,
  and the structural pieces. The numbers are not here -- they come from
  the order, which is what lets a clause be moved or taken out.

  A heading (no role, no text) groups the clauses that follow it, exactly
  as "1 Operation" has always grouped 1.1 to 1.3.
*/
const STANDARD_CLAUSES: ReadonlyArray<StandardClause> = [
  { id: "operation", title: "Operation", level: 1, enabled: true },
  { id: "helpdeskScheduling", role: "helpdeskScheduling", title: "Helpdesk and Scheduling", level: 2, enabled: true },
  { id: "maintenanceTeam", role: "maintenanceTeam", title: "Maintenance Team", level: 2, enabled: true },
  { id: "workingHours", role: "workingHours", title: "Working Hours", level: 2, enabled: true },
  { id: "scopeIntro", role: "scopeIntro", title: "Scope of Works", level: 1, enabled: true },
  { id: "scopeServices", role: "scopeServices", title: "Services on this contract", level: 2, enabled: true },
  { id: "callOuts", title: "Emergency & Non-Emergency Call-Out", level: 1, enabled: true },
  { id: "emergencyCallOut", role: "emergencyCallOut", title: "Emergency Call-Out", level: 2, enabled: true },
  { id: "nonEmergencyCallOut", role: "nonEmergencyCallOut", title: "Non-Emergency Call-Out", level: 2, enabled: true },
  { id: "materials", role: "materials", title: "Materials, Spare Parts, Consumables & Labor", level: 1, enabled: true },
  { id: "servicesExcluded", role: "servicesExcluded", title: "Services Excluded", level: 1, enabled: true },
  { id: "excludedOffer", role: "excludedOffer", title: "Other Services We Offer", level: 2, enabled: true },
  { id: "frequency", title: "Service Frequency & Provisions", level: 1, enabled: true },
  { id: "servicesTable", role: "servicesTable", title: "Scope of work and frequency", level: 2, enabled: true },
  { id: "priceListIntro", role: "priceListIntro", title: "Supply and Installation Price List", level: 2, enabled: true },
  { id: "handymanRates", role: "handymanRates", title: "Extra Handyman Rates", level: 2, enabled: true },
  { id: "generalTerms", role: "generalTerms", title: "General Terms and Conditions and Payment", level: 1, enabled: true },
  { id: "bankDetails", role: "bankDetails", title: "Bank Details", level: 2, enabled: true },
  { id: "invoiceTerms", role: "invoiceTerms", title: "Invoices and Contract Term", level: 2, enabled: true },
  { id: "termination", role: "termination", title: "Termination", level: 1, enabled: true },
  { id: "contractConfirmation", role: "contractConfirmation", title: "Confirmation", level: 2, enabled: true },
  { id: "signatures", role: "signatures", title: "Signatures", level: 2, enabled: true },
];

/** The standard list, with each clause's text filled in from `clauses`. */
export function clauseListFrom(clauses: AmcSettings["clauses"]): AmcClause[] {
  const textRoles = new Set<string>(AMC_CLAUSE_TEXT_ROLES);
  return STANDARD_CLAUSES.map((clause) => ({
    ...clause,
    body:
      clause.role && textRoles.has(clause.role)
        ? (clauses[clause.role as AmcClauseTextRole] ?? "")
        : "",
  }));
}

/**
 * The list keyed by role, which is the shape the document builder reads.
 *
 * A clause an admin removed is absent, so a builder that asks for it gets
 * the empty string and prints nothing -- which is what removing it means.
 */
export function clausesByRole(list: AmcClause[]): AmcSettings["clauses"] {
  const byRole = {} as AmcSettings["clauses"];
  for (const role of AMC_CLAUSE_TEXT_ROLES) byRole[role] = "";
  const textRoles = new Set<string>(AMC_CLAUSE_TEXT_ROLES);
  for (const clause of list) {
    if (clause.role && clause.enabled !== false && textRoles.has(clause.role)) {
      byRole[clause.role as AmcClauseTextRole] = clause.body;
    }
  }
  return byRole;
}

export function getAmcSettingsDefaults(): AmcSettings {
  /* A service with a scope section in the contract uses that section's
     text; the rest (emergency, non-emergency, helpdesk) have only the one
     line they show in the proposal's coverage column. */
  const serviceScopes: Record<string, string> = {};
  for (const service of AMC_SERVICES) {
    const section = SCOPE_SECTIONS.find(
      (item) => item.serviceId === service.id,
    );
    serviceScopes[service.id] = section
      ? joinLines(section.intro, section.bullets)
      : (SERVICE_SUMMARY[service.id] ?? service.scope);
  }

  const defaults: AmcSettings = {
    provider: {
      contactNo: AMC_PROVIDER.contactNo,
      coordinationEmails: [...AMC_PROVIDER.coordinationEmails],
      poBox: AMC_PROVIDER.poBox,
      email: AMC_PROVIDER.email,
      address: AMC_PROVIDER.address,
      contractType: AMC_PROVIDER.contractType,
      standardResponseTime: "Within 48 hours",
      emergencyResponseTime: "Within 120 minutes",
      proposalValidity: "1 Year",
    },
    clauses: {
      helpdeskScheduling: clause1Section("1.1 Helpdesk and Scheduling", "paragraphs"),
      maintenanceTeam: clause1Section("1.2 Maintenance team", "bullets"),
      workingHours: clause1Section("1.3 Working hours", "paragraphs"),
      scopeIntro: `${CLAUSE_2_INTRO[1]} ${CLAUSE_2_INTRO[2]}`,
      emergencyCallOut: clause3Section("3.1"),
      nonEmergencyCallOut: clause3Section("3.2"),
      materials: joinLines(CLAUSE_4_MATERIALS.paragraphs),
      servicesExcluded: joinLines(
        CLAUSE_5_EXCLUDED.intro,
        CLAUSE_5_EXCLUDED.bullets,
      ),
      excludedOffer: joinLines(CLAUSE_5_EXCLUDED.footerParagraphs),
      priceListIntro: joinLines(
        CLAUSE_6_2_INTRO[0].replace(/\.$/, ""),
        CLAUSE_6_2_INTRO.slice(1),
      ),
      handymanRates: joinLines(
        CLAUSE_6_3_HANDYMAN.title,
        CLAUSE_6_3_HANDYMAN.rates.map((rate) => rate.text),
      ),
      generalTerms: joinLines(CLAUSE_7_TERMS),
      bankDetails: joinLines(BANK_DETAILS.map((row) => `${row.label}: ${row.value}`)),
      invoiceTerms: joinLines(
        "All invoices should be settled within 7 working days from the date of submittal, via email or hardcopy. Failure of payments will be notified and may be grounds for temporary suspension of services or termination of contract.",
        "The term of this contract shall commence for 1 year as stated in the contract details.",
      ),
      termination: joinLines(CLAUSE_8_TERMINATION.paragraphs),
      contractConfirmation: CLAUSE_8_TERMINATION.confirmation.replace(/\.?$/, "."),
      proposalNotes: joinLines([...PROPOSAL_IMPORTANT_NOTES]),
      proposalAcceptance: "I hereby accept this proposal on the terms set out above.",
    },
    /*
      Seeded from the list the code has shipped, so an install that has
      never touched them renders exactly as it did.
    */
    services: AMC_SERVICES.map((service) => ({
      id: service.id,
      label: service.label,
      scope: service.scope,
      sectionTitle: SCOPE_SECTIONS.find((item) => item.serviceId === service.id)?.title,
      frequencyType: service.frequencyType,
      frequencyPerYear: service.frequencyPerYear,
      villaOnly: service.villaOnly,
      unitTypes: service.villaOnly ? (["villa"] as const).slice() : [...AMC_UNIT_TYPES],
      hasScopeSection: service.hasScopeSection,
      reference: service.reference ?? "",
      enabled: true,
    })),
    serviceScopes,
    brochure: getAmcBrochureDefaults(),
    approval: { approvers: [] },
    /* Set below, from the clauses just built -- one copy of the wording. */
    clauseList: [],
  };
  defaults.clauseList = clauseListFrom(defaults.clauses);
  return defaults;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Defaults with the admin's edits applied.
 *
 * An empty string is a real edit — an admin clearing a clause means the
 * clause is empty, not that it should fall back to the shipped text — so
 * this checks for presence, not truthiness.
 */
export function mergeAmcSettings(
  defaults: AmcSettings,
  overrides: AmcSettingsOverrides | null | undefined,
): AmcSettings {
  if (!overrides) return defaults;

  /*
    The clauses, as a list and keyed by role.

    A saved list wins outright: adding, removing and moving cannot be
    merged key by key. An override saved before the list existed carries
    only `clauses`, so those edits are laid over the standard wording and
    read into the standard order -- the document it produces is the one it
    produced before.
  */
  const mergedClauses = {
    ...defaults.clauses,
    ...Object.fromEntries(
      Object.entries(overrides.clauses ?? {}).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  };
  const clauseList = (
    overrides.clauseList?.length ? overrides.clauseList : clauseListFrom(mergedClauses)
  ).filter(
    /* The old proposal template's notes and acceptance line: the proposal
       is the brochure alone now (2026-09-28), so they print nowhere and are
       dropped from a list saved while they still did. */
    (clause) => clause.role !== "proposalNotes" && clause.role !== "proposalAcceptance",
  );

  return {
    /* Every value falls back on its own, so a snapshot or override saved
       before a value existed still gets the standard one. */
    provider: {
      ...defaults.provider,
      ...Object.fromEntries(
        Object.entries(overrides.provider ?? {}).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    },
    /* Keyed by role, which is what the document builder reads -- and so a
       clause removed from the list simply is not there. */
    clauses: { ...mergedClauses, ...clausesByRole(clauseList) },
    clauseList,
    /* Whole, not merged: a service added or removed is not a per-key
       edit, exactly as with the clauses. */
    services: overrides.services?.length ? overrides.services : defaults.services,
    serviceScopes: {
      ...defaults.serviceScopes,
      ...(overrides.serviceScopes ?? {}),
    },
    /* Field by field, so a snapshot sent before the brochure existed (or
       before a field was added) prints the standard wording. */
    brochure: {
      ...defaults.brochure,
      ...Object.fromEntries(
        Object.entries(overrides.brochure ?? {}).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    },
    approval: {
      approvers: overrides.approval?.approvers ?? defaults.approval.approvers,
    },
  };
}

/**
 * FR5.3: may this person approve or send back a submitted proposal?
 *
 * When AMC Settings names approvers, only they can. When it names nobody,
 * the role permission (AMC approve) decides, which is how it worked before
 * approvers could be chosen.
 */
export function canApproveAmc(
  settings: Pick<AmcSettings, "approval">,
  email: string | null | undefined,
  hasRolePermission: boolean,
): boolean {
  const approvers = (settings.approval?.approvers ?? []).map((item) => item.trim().toLowerCase());
  if (approvers.length === 0) return hasRolePermission;
  return Boolean(email) && approvers.includes(email!.trim().toLowerCase());
}

/**
 * FR6.4 — which text a document should render with.
 *
 * A submission that has been sent carries a snapshot and renders from it
 * forever, so editing settings never rewrites a document a client already
 * holds. A draft has no snapshot and follows live settings, which is what
 * the team wants while they are still working on it.
 */
/**
 * The services a proposal may offer, for a property of this type.
 *
 * The one place that answers it, so the proposal's list, the contract's
 * scope and the frequency table cannot drift apart. A service switched
 * off stays on file -- proposals that already carry it still render --
 * but is not offered on a new one.
 */
export function servicesForProperty(
  settings: Pick<AmcSettings, "services">,
  unitType?: string,
): AmcServiceDefinition[] {
  return settings.services.filter((service) => {
    if (service.enabled === false) return false;
    if (!unitType) return true;
    /* The list wins where it is set; the old flag answers for services
       saved before property types could be chosen. */
    if (service.unitTypes?.length) {
      return service.unitTypes.includes(unitType as "villa" | "apartment" | "office");
    }
    return !service.villaOnly || unitType === "villa";
  });
}

/** Every kind of property, for a service that names none. */
export const AMC_UNIT_TYPES = ["villa", "apartment", "office"] as const;

/** How a service's property types read on screen. */
export function unitTypesLabel(service: Pick<AmcServiceDefinition, "unitTypes" | "villaOnly">) {
  const types = service.unitTypes?.length
    ? service.unitTypes
    : service.villaOnly
      ? (["villa"] as const)
      : AMC_UNIT_TYPES;
  if (types.length === AMC_UNIT_TYPES.length) return "Offered on every property type.";
  const names = types.map((type) => (type === "villa" ? "villas" : `${type}s`));
  return `Offered on ${names.join(" and ")} only.`;
}

export function resolveAmcSettings(
  live: AmcSettings,
  snapshot: AmcSettings | null | undefined,
): AmcSettings {
  /* Merged over the defaults, not returned as-is: a proposal sent before a
     clause became editable has no copy of it in its snapshot. At send time
     that clause could only have been the shipped text, which is what the
     default still is — so the document prints exactly as it was sent. */
  return snapshot ? mergeAmcSettings(getAmcSettingsDefaults(), snapshot) : live;
}
