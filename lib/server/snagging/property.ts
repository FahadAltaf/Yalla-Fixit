import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The property record (BR-1): snagging_clients -> snagging_properties -> jobs.
 *
 * A property belongs to a client and is reused across every job on that
 * unit (initial visit, de-snag rounds, additional visits). This module
 * centralises the mapping of validated input to the property columns —
 * including the type-conditional rules — and the find-or-create-or-update
 * resolution used by job creation and the property endpoints.
 */
type Admin = SupabaseClient;

export type PropertyFields = {
  unit_label: string;
  building_name?: string | null;
  community?: string | null;
  property_type: "apartment" | "villa" | "townhouse" | "commercial";
  developer_name?: string | null;
  bedrooms?: number | null;
  built_up_area_sqft?: number | null;
  plot_area_sqft?: number | null;
  external_areas_in_scope?: boolean | null;
  floors?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  title_deed_path?: string | null;
  noc_required?: boolean | null;
  noc_path?: string | null;
};

function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Validated property input -> property columns, applying the rules that only
 * some fields apply to some types (bedrooms hidden for commercial, plot for
 * villa/townhouse, floors for villa).
 */
export function propertyColumns(p: PropertyFields): Record<string, unknown> {
  const t = p.property_type;
  return {
    unit_label: p.unit_label,
    building_name: clean(p.building_name),
    community: clean(p.community),
    property_type: t,
    developer_name: clean(p.developer_name),
    bedrooms: t === "commercial" ? null : p.bedrooms ?? null,
    built_up_area_sqft: p.built_up_area_sqft ?? null,
    plot_area_sqft: t === "villa" || t === "townhouse" ? p.plot_area_sqft ?? null : null,
    external_areas_in_scope: Boolean(p.external_areas_in_scope),
    floors: t === "villa" ? p.floors ?? null : null,
    location_lat: p.location_lat ?? null,
    location_lng: p.location_lng ?? null,
    title_deed_path: clean(p.title_deed_path),
    noc_required: Boolean(p.noc_required),
    noc_path: clean(p.noc_path),
  };
}

/** The 5 columns the job keeps as a denormalised snapshot (list / search / mobile wire). */
export function propertySnapshot(columns: Record<string, unknown>): Record<string, unknown> {
  return {
    unit_label: columns.unit_label,
    building_name: columns.building_name,
    community: columns.community,
    property_type: columns.property_type,
    developer_name: columns.developer_name,
  };
}

const norm = (value: unknown): string => ((value as string) ?? "").trim().toLowerCase();

/**
 * Resolves the property for a job, returning its id and columns.
 *
 * An explicit id updates that property (edit through the job flow). Without
 * one, the client's property on the same unit is reused (and refreshed),
 * else a new property is created — so two jobs on the same unit share one
 * record rather than duplicating it.
 */
export async function resolveProperty(
  admin: Admin,
  opts: { propertyId?: string | null; clientId: string; fields: PropertyFields; createdBy: string },
): Promise<{ id: string; columns: Record<string, unknown> }> {
  const columns = propertyColumns(opts.fields);
  const now = new Date().toISOString();

  if (opts.propertyId) {
    const { data, error } = await admin
      .from("snagging_properties")
      .update({ ...columns, updated_at: now })
      .eq("id", opts.propertyId)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id, columns };
  }

  const { data: candidates } = await admin
    .from("snagging_properties")
    .select("id, building_name, community")
    .eq("client_id", opts.clientId)
    .eq("unit_label", columns.unit_label as string)
    .limit(50);

  const match = (candidates ?? []).find(
    (c: { building_name: string | null; community: string | null }) =>
      norm(c.building_name) === norm(columns.building_name) &&
      norm(c.community) === norm(columns.community),
  ) as { id: string } | undefined;

  if (match) {
    const { error } = await admin
      .from("snagging_properties")
      .update({ ...columns, updated_at: now })
      .eq("id", match.id);
    if (error) throw new Error(error.message);
    return { id: match.id, columns };
  }

  const { data, error } = await admin
    .from("snagging_properties")
    .insert({ ...columns, client_id: opts.clientId, created_by: opts.createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, columns };
}
