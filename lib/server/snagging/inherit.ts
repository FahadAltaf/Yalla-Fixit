/**
 * What a de-snag round or an additional visit inherits from the job it
 * was opened against.
 *
 * A round and a visit are return trips to the same flat for the same
 * client, so everything describing the unit and how to get into it
 * belongs on them from the moment they are created. Only the appointment
 * itself is genuinely new.
 *
 * This was a hand-written list on each insert, and both had drifted:
 * the site contacts, the appointment time and the property measurements
 * were simply left behind, so an inspector opened a round with an empty
 * Setup tab and no phone number for the person who lets them in.
 * Keeping the list here means the two routes cannot disagree again.
 */

/** Columns to read off the parent when opening a round or a visit. */
export const INHERITED_COLUMNS = [
  "id",
  "code",
  "status",
  "round_number",
  "client_id",
  "property_id",
  "unit_label",
  "building_name",
  "community",
  "property_type",
  "developer_name",
  "inspector_id",
  "approval_manager_id",
  "scheduled_date",
  "appointment_at",
  "notes",
  // Site contacts (FR-3.03) — who the inspector calls on the day.
  "developer_contact_name",
  "developer_contact_phone",
  "client_contact_name",
  "client_contact_phone",
  // The unit's own measurements, which the job carries as a snapshot for
  // jobs raised before the property record existed.
  "bedrooms",
  "built_up_area_sqft",
  "plot_area_sqft",
  "external_areas_in_scope",
  "floors",
  "location_lat",
  "location_lng",
  // Access paperwork (FR-3.04 / FR-1.09).
  "noc_required",
  "noc_path",
  "title_deed_path",
] as const;

export const INHERITED_SELECT = INHERITED_COLUMNS.join(", ");

export type InheritableJob = Record<string, unknown> & {
  id: string;
  code: string;
  status: string;
  round_number: number | null;
};

/**
 * The inherited half of a new round or visit's row.
 *
 * Deliberately excludes anything that belongs to the parent's own
 * lifecycle — its status timestamps, signature, rejection reason, lock
 * and charge. A return trip starts its own clock.
 */
export function inheritedFields(parent: InheritableJob): Record<string, unknown> {
  return {
    client_id: parent.client_id,
    property_id: parent.property_id,
    unit_label: parent.unit_label,
    building_name: parent.building_name,
    community: parent.community,
    property_type: parent.property_type,
    developer_name: parent.developer_name,
    appointment_at: parent.appointment_at,
    developer_contact_name: parent.developer_contact_name,
    developer_contact_phone: parent.developer_contact_phone,
    client_contact_name: parent.client_contact_name,
    client_contact_phone: parent.client_contact_phone,
    bedrooms: parent.bedrooms,
    built_up_area_sqft: parent.built_up_area_sqft,
    plot_area_sqft: parent.plot_area_sqft,
    external_areas_in_scope: parent.external_areas_in_scope,
    floors: parent.floors,
    location_lat: parent.location_lat,
    location_lng: parent.location_lng,
    noc_required: parent.noc_required,
    noc_path: parent.noc_path,
    title_deed_path: parent.title_deed_path,
  };
}
