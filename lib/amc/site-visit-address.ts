import { requiredPropertyErrors, type RequiredPropertyKey } from "@/lib/snagging/quotation-required";

/** What a quotation (and a site visit) needs of an address, by label. */
export const SITE_VISIT_FIELD_LABELS: Record<RequiredPropertyKey, string> = {
  unit_label: "Unit reference",
  building_name: "Project / tower",
  property_type: "Property type",
  bedrooms: "Bedrooms",
  built_up_area: "Built-up area",
};

/**
 * What a Snagging address lacks for a site visit, by label (empty when it
 * is complete). One rule for the address list and the property's own read,
 * so a picker can tell from the property it already has.
 */
export function siteVisitMissing(row: {
  unit_label?: unknown;
  building_name?: unknown;
  property_type?: unknown;
  bedrooms?: unknown;
  built_up_area_sqft?: unknown;
}): string[] {
  return (
    Object.keys(
      requiredPropertyErrors({
        unit_label: row.unit_label,
        building_name: row.building_name,
        property_type: row.property_type,
        bedrooms: row.bedrooms,
        built_up_area: row.built_up_area_sqft,
      }),
    ) as RequiredPropertyKey[]
  ).map((k) => SITE_VISIT_FIELD_LABELS[k]);
}
