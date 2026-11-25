/*
  The contract type each proposal carries (DEV-500, BRD v0.4 5.4):
  Comprehensive, Semi-Comprehensive or Non-Comprehensive, shown in the
  contract heading. Kept in the proposal's customer block, so the contract
  made from it carries it too (amc_contracts.customer).
*/
export const CONTRACT_TYPES = ["comprehensive", "semi_comprehensive", "non_comprehensive"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  comprehensive: "Comprehensive",
  semi_comprehensive: "Semi-Comprehensive",
  non_comprehensive: "Non-Comprehensive",
};

/** The label of a stored value, or null when none was chosen (proposals before DEV-500). */
export function contractTypeLabel(value: unknown): string | null {
  return typeof value === "string" && value in CONTRACT_TYPE_LABELS ? CONTRACT_TYPE_LABELS[value as ContractType] : null;
}

/**
 * The tracker's wording (DEV-486 import) as a type: "Comprehensive",
 * "Semi Comprehensive", "semi-comp", "Non Comprehensive", "non-comp".
 */
export function parseContractType(text: string | null | undefined): ContractType | null {
  const t = (text ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return null;
  if (t.startsWith("non")) return "non_comprehensive";
  if (t.startsWith("semi")) return "semi_comprehensive";
  if (t.startsWith("comp")) return "comprehensive";
  return null;
}
