/**
 * The AMC proposal number format, as the database allocates it.
 *
 * The database is the only thing that issues numbers (the column default
 * calls public.amc_next_proposal_number(), migration 20261005110000). This
 * mirrors its rule so the rule can be tested and read in one place:
 * AMC-<year in Dubai>-<sequence, padded to at least four digits, never cut>.
 */
export function formatProposalNumber(year: number, sequence: number): string {
  const digits = String(Math.trunc(sequence));
  return `AMC-${year}-${digits.padStart(Math.max(4, digits.length), "0")}`;
}

/** What the number default produced before 20261005110000 (lpad truncates). */
export function legacyFormatProposalNumber(year: number, sequence: number): string {
  const digits = String(Math.trunc(sequence));
  const padded = digits.length >= 4 ? digits.slice(0, 4) : digits.padStart(4, "0");
  return `AMC-${year}-${padded}`;
}
