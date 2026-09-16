import { z } from "zod";

import { AMC_PROVIDER, AMC_SERVICES } from "./amc-constants";
import {
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
  }),
  /*
    FR6.2 — standard text, keyed by clause. Only the clauses the FRD names
    are editable; the rest of the contract stays in code, because making
    every string editable turns a settings page into a word processor
    nobody can safely use.
  */
  clauses: z.object({
    emergencyCallOut: z.string(),
    nonEmergencyCallOut: z.string(),
    materials: z.string(),
    servicesExcluded: z.string(),
    termination: z.string(),
  }),
  /* FR6.2 — "the scope of work for each service", keyed by service id. */
  serviceScopes: z.record(z.string(), z.string()),
});

export type AmcSettings = z.infer<typeof amcSettingsSchema>;

/* What an admin has changed. Every branch optional, because the stored
   document holds edits only. */
export const amcSettingsOverridesSchema = z
  .object({
    provider: amcSettingsSchema.shape.provider.partial().optional(),
    clauses: amcSettingsSchema.shape.clauses.partial().optional(),
    serviceScopes: z.record(z.string(), z.string()).optional(),
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
      : service.scope;
  }

  return {
    provider: {
      contactNo: AMC_PROVIDER.contactNo,
      coordinationEmails: [...AMC_PROVIDER.coordinationEmails],
    },
    clauses: {
      emergencyCallOut: clause3Section("3.1"),
      nonEmergencyCallOut: clause3Section("3.2"),
      materials: joinLines(CLAUSE_4_MATERIALS.paragraphs),
      servicesExcluded: joinLines(
        CLAUSE_5_EXCLUDED.intro,
        CLAUSE_5_EXCLUDED.bullets,
      ),
      termination: joinLines(CLAUSE_8_TERMINATION.paragraphs),
    },
    serviceScopes,
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
    provider: {
      contactNo:
        overrides.provider?.contactNo ?? defaults.provider.contactNo,
      coordinationEmails:
        overrides.provider?.coordinationEmails ??
        defaults.provider.coordinationEmails,
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
  };
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
  return snapshot ?? live;
}
