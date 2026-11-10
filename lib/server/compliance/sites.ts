// Current site = an FSM client plus optional project location (FRD D4).
// Thin adapter over the snagging module's FSM client helpers, which already
// list FSM contacts and create the portal rows (snagging_clients,
// snagging_properties) when one is picked. When FSM is not configured, the
// portal's own client list is offered instead.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fsmClientsReady,
  fsmOnlyAddresses,
  isRealAddressId,
  linkFsmAddress,
  linkFsmContact,
  listFsmClients,
} from "@/lib/server/snagging/fsm-clients";
import { listClients } from "@/lib/server/snagging/client-list";
import type { EmployeeSite, SiteClientOption, SitePropertyOption } from "@/lib/compliance/types";

type PropertyRow = { id: string; client_id: string | null; unit_label: string | null; building_name: string | null; community: string | null; fsm_address_id?: string | null };

export function propertyLabel(p: { unit_label: string | null; building_name: string | null; community: string | null }): string {
  return [p.unit_label, p.building_name, p.community].filter((v) => v && v.trim()).join(", ") || "Project location";
}

/** The client and property rows the employees reference, keyed for the read model. */
export async function loadSiteLookup(
  admin: SupabaseClient,
  clientIds: string[],
  propertyIds: string[],
): Promise<(clientId: string | null, propertyId: string | null) => EmployeeSite | null> {
  const clients = new Map<string, string>();
  const properties = new Map<string, { label: string; client_id: string | null }>();
  const uniqueClients = [...new Set(clientIds.filter(Boolean))];
  const uniqueProps = [...new Set(propertyIds.filter(Boolean))];
  try {
    if (uniqueClients.length) {
      const { data } = await admin.from("snagging_clients").select("id, name").in("id", uniqueClients);
      (data ?? []).forEach((c: { id: string; name: string }) => clients.set(c.id, c.name));
    }
    if (uniqueProps.length) {
      const { data } = await admin.from("snagging_properties").select("id, client_id, unit_label, building_name, community").in("id", uniqueProps);
      (data ?? []).forEach((p: PropertyRow) => properties.set(p.id, { label: propertyLabel(p), client_id: p.client_id }));
    }
  } catch (error) {
    // The snagging tables may not exist on a bare stack; sites then show as unassigned.
    console.error("Compliance site lookup failed:", error);
  }
  return (clientId, propertyId) => {
    if (!clientId) return null;
    const name = clients.get(clientId);
    if (!name) return { client_id: clientId, client_name: "Unknown client", property_id: null, property_label: null };
    const prop = propertyId ? properties.get(propertyId) : undefined;
    return { client_id: clientId, client_name: name, property_id: prop ? propertyId : null, property_label: prop?.label ?? null };
  };
}

/** Clients to pick from: FSM when configured, otherwise the portal's own. */
export async function searchSiteClients(
  admin: SupabaseClient,
  search: string | null,
  page: number,
  perPage: number,
): Promise<{ data: SiteClientOption[]; hasMore: boolean; source: "fsm" | "portal" }> {
  if (await fsmClientsReady(admin)) {
    const result = await listFsmClients(admin, { search, page, perPage });
    return {
      data: result.data.map((c) => ({
        id: c.id ?? "",
        name: c.client_name,
        company: c.company,
        fsm_contact_id: c.fsm_contact_id ?? null,
        source: "fsm" as const,
      })),
      hasMore: result.hasMore,
      source: "fsm",
    };
  }
  const params = new URLSearchParams({ page: String(page), pageSize: String(perPage) });
  if (search) params.set("search", search);
  const result = await listClients(admin, params);
  const rows = result.data ?? [];
  return {
    data: rows.map((c) => ({ id: c.id, name: c.client_name, company: c.company, fsm_contact_id: null, source: "portal" as const })),
    hasMore: (page + 1) * perPage < (result.totalCount ?? 0),
    source: "portal",
  };
}

/**
 * Make sure an FSM contact has a portal row and return its id. A client
 * that already has an id is returned as is.
 */
export async function ensureSiteClient(
  admin: SupabaseClient,
  option: { id?: string | null; fsm_contact_id?: string | null },
  actorId: string,
): Promise<{ id: string; name: string }> {
  if (option.id) {
    const { data, error } = await admin.from("snagging_clients").select("id, name").eq("id", option.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as { id: string; name: string };
  }
  if (!option.fsm_contact_id) throw new Error("Choose a client");
  const linked = await linkFsmContact(admin, option.fsm_contact_id, actorId);
  if (!linked.id) throw new Error("Client could not be linked");
  return { id: linked.id, name: linked.client_name };
}

/** Project locations under a client: linked rows first, then FSM-only addresses. */
export async function listSiteProperties(admin: SupabaseClient, clientId: string): Promise<SitePropertyOption[]> {
  const { data, error } = await admin
    .from("snagging_properties")
    .select("id, client_id, unit_label, building_name, community, fsm_address_id")
    .eq("client_id", clientId)
    .order("building_name", { ascending: true });
  if (error) throw new Error(error.message);
  const linked = (data ?? []) as PropertyRow[];
  const options: SitePropertyOption[] = linked.map((p) => ({ id: p.id, label: propertyLabel(p), fsm_address_id: p.fsm_address_id ?? null }));
  if (await fsmClientsReady(admin)) {
    const linkedIds = new Set(linked.map((p) => p.fsm_address_id).filter((v): v is string => Boolean(v)));
    const { rows } = await fsmOnlyAddresses(admin, clientId, linkedIds);
    for (const r of rows as unknown as PropertyRow[]) {
      const fsmId = r.fsm_address_id ?? null;
      if (!fsmId || !isRealAddressId(fsmId)) continue;
      options.push({ id: `fsm:${fsmId}`, label: propertyLabel(r), fsm_address_id: fsmId });
    }
  }
  return options;
}

/** An "fsm:<addressId>" choice becomes a portal property row; a plain id is checked to belong to the client. */
export async function ensureSiteProperty(
  admin: SupabaseClient,
  clientId: string,
  choice: string,
  actorId: string,
): Promise<string> {
  if (choice.startsWith("fsm:")) {
    const row = await linkFsmAddress(admin, clientId, choice.slice(4), actorId);
    return (row as unknown as { id: string }).id;
  }
  const { data, error } = await admin.from("snagging_properties").select("id, client_id").eq("id", choice).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || (data as { client_id: string | null }).client_id !== clientId) throw new Error("That project location does not belong to the chosen client");
  return choice;
}
