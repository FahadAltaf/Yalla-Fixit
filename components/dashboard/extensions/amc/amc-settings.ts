import { z } from "zod";

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
  /* FR6.2 — "the scope of work for each service", keyed by service id. */
  serviceScopes: z.record(z.string(), z.string()),
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
    serviceScopes: z.record(z.string(), z.string()).optional(),
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

  return {
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
        CLAUSE_6_2_INTRO[0].replace(/^6\.2\s*/, "").replace(/\.$/, ""),
        CLAUSE_6_2_INTRO.slice(1),
      ),
      handymanRates: joinLines(
        CLAUSE_6_3_HANDYMAN.title.replace(/^6\.3\s*/, ""),
        CLAUSE_6_3_HANDYMAN.rates.map((rate) => `${rate.label} ${rate.text}`),
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
    serviceScopes,
    approval: { approvers: [] },
  };
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
    clauses: {
      ...defaults.clauses,
      ...Object.fromEntries(
        Object.entries(overrides.clauses ?? {}).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    },
    serviceScopes: {
      ...defaults.serviceScopes,
      ...(overrides.serviceScopes ?? {}),
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
