import type { SnaggingPropertyType } from "@/types/types";

/**
 * The property fields a quotation cannot be raised without (SNG-017).
 *
 * One rule for the form and the API: the form shows each message under its
 * field, the API refuses with the first one, so a quotation can never be
 * saved with a field the form marks with a star left empty.
 */

export const PROPERTY_TYPES: readonly SnaggingPropertyType[] = [
  "apartment",
  "villa",
  "townhouse",
  "commercial",
];

export type RequiredPropertyKey =
  | "unit_label"
  | "building_name"
  | "property_type"
  | "bedrooms"
  | "built_up_area";

export type RequiredPropertyInput = {
  unit_label?: unknown;
  building_name?: unknown;
  property_type?: unknown;
  /** 0 is a studio, so only null or undefined counts as missing. */
  bedrooms?: unknown;
  built_up_area?: unknown;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function requiredPropertyErrors(
  p: RequiredPropertyInput,
): Partial<Record<RequiredPropertyKey, string>> {
  const errors: Partial<Record<RequiredPropertyKey, string>> = {};

  if (!text(p.unit_label)) {
    errors.unit_label = "The inspector finds the property by this reference, so it is required.";
  }
  if (!text(p.building_name)) {
    errors.building_name = "Enter the project or tower the unit is in.";
  }

  const type = text(p.property_type);
  if (!PROPERTY_TYPES.includes(type as SnaggingPropertyType)) {
    errors.property_type = "Choose the property type. It sets the rate and the rooms.";
  } else if (type !== "commercial") {
    const beds = p.bedrooms;
    const n = beds === null || beds === undefined || beds === "" ? NaN : Number(beds);
    if (!Number.isInteger(n) || n < 0) {
      errors.bedrooms = "Choose the number of bedrooms (Studio if there are none).";
    }
  }

  const area = text(String(p.built_up_area ?? ""));
  if (!(Number(area) > 0)) {
    errors.built_up_area = area
      ? "Enter the area as a number greater than 0."
      : "The quotation is priced from this, so it is required.";
  }

  return errors;
}

/** The first missing field's message, for an API to refuse with. */
export function firstRequiredPropertyError(p: RequiredPropertyInput): string | null {
  const errors = requiredPropertyErrors(p);
  const order: RequiredPropertyKey[] = [
    "unit_label",
    "building_name",
    "property_type",
    "bedrooms",
    "built_up_area",
  ];
  for (const key of order) if (errors[key]) return errors[key] as string;
  return null;
}
