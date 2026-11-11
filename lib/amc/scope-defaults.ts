import { AMC_SCOPE_LIBRARY, type AmcLibraryService } from "@/components/dashboard/extensions/amc/amc-scope-library";

/*
  What the Standard Scope of Works Library (Rev. 01, October 2026) says a
  service is, for the screens that need one fact of it rather than the whole
  clause: a contract's coverage (its exclusions), a call out's coverage check,
  the rate card (its unit and default frequency).

  A contract's own value always wins; the library is the starting point and
  the fallback, so a contract created before any terms were set still says
  what its services leave out.
*/

const byId = new Map<string, AmcLibraryService>(AMC_SCOPE_LIBRARY.map((entry) => [entry.id, entry]));

/** The library's entry for a service (A1 to G6), or null for one it does not cover (the hotline, the call-outs, a custom service). */
export function libraryEntry(serviceId: string): AmcLibraryService | null {
  return byId.get(serviceId) ?? null;
}

/** The library's exclusions for a service, or null. */
export function standardExclusions(serviceId: string): string | null {
  return byId.get(serviceId)?.exclusions?.trim() || null;
}

/** A contract's exclusions for a service: its own when set, else the library's standard ones. */
export function effectiveExclusions(serviceId: string, own: string | null | undefined): { text: string | null; standard: boolean } {
  const mine = own?.trim();
  if (mine) return { text: mine, standard: false };
  const fallback = standardExclusions(serviceId);
  return { text: fallback, standard: Boolean(fallback) };
}

/** The library's unit of measure, as it reads to the client ("Per AC unit per visit"), or null. */
export function standardUnit(serviceId: string): string | null {
  return byId.get(serviceId)?.unitOfMeasure ?? null;
}

/** The library's default frequency as written ("1-2 times per year"), or null. */
export function standardFrequency(serviceId: string): string | null {
  return byId.get(serviceId)?.defaultFrequency ?? null;
}
