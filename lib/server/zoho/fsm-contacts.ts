import { fsmFetch, fsmGetRecord } from "@/lib/server/zoho/fsm-client";

/**
 * Zoho FSM contacts and their addresses: the FSM side of the Clients page
 * and the client and address pickers. Only FSM calls here; linking to the
 * portal's own rows is lib/server/snagging/fsm-clients.ts.
 *
 * What FSM's API allows, checked against the live account (Oct 2026):
 *   - Contacts list 200 a page, sortable by Created_Time. There is no total.
 *   - Search works on Email, Last_Name, Mobile and Phone only, with
 *     "contains". First names are not searchable.
 *   - A contact's addresses are a related list (/Contacts/{id}/Addresses).
 *     There is no endpoint for every address, and none to add one: an
 *     address is created as the Service_Address of a contact create or edit.
 */

type Raw = Record<string, any>;

export class FsmApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

/*
  Zoho's own reason, readable, from a failed response. Zoho puts the error
  in several places: at the top, in data[0], or under the module's name
  (data.Contacts[0]); and names the field as details.api_name or
  details.field.api_name. "invalid data" alone says nothing, so the field
  and the type FSM expected are added when Zoho gives them.
*/
function zohoError(json: any): any {
  const data = json?.data;
  if (Array.isArray(data)) return data[0];
  if (data && typeof data === "object") {
    const nested = Object.values(data).find((v) => Array.isArray(v)) as any[] | undefined;
    if (nested?.[0]) return nested[0];
    return data;
  }
  return null;
}

function describeZohoError(json: any, status: number, fallback: string): string {
  /*
    A refused create names the record's problem one level down, under the
    module: { code: "INVALID_DATA", details: { Contacts: [{ code:
    "MANDATORY_NOT_FOUND", details: { api_name: "Maher_Id__C" } }] } }.
  */
  const perRecord =
    json?.details && typeof json.details === "object"
      ? ((Object.values(json.details).find((v) => Array.isArray(v)) as any[] | undefined)?.[0] ?? null)
      : null;
  if (perRecord?.code === "MANDATORY_NOT_FOUND") {
    const missing = perRecord?.details?.api_name;
    // Which record: a contact's create can fail on its company (details.Companies).
    const recordModule = Object.keys(json.details).find((k) => Array.isArray(json.details[k]));
    const what =
      recordModule === "Companies"
        ? "a company"
        : recordModule === "Contacts"
          ? "a contact"
          : (recordModule ?? "the record");
    return `Zoho FSM requires the field ${missing ?? "(not named)"} on ${what}, which the portal did not send`;
  }
  const first = perRecord ?? zohoError(json);
  const message =
    first?.message ?? json?.message ?? json?.error ?? (typeof json?.code === "string" ? json.code : null);
  const details = first?.details ?? json?.details ?? {};
  const field = details?.api_name ?? details?.field?.api_name;
  const expected = details?.expected_data_type ?? details?.data_type;
  const extra = [field ? `field ${field}` : null, expected ? `expected ${expected}` : null].filter(Boolean).join(", ");
  return `${message ?? `${fallback} ${status}`}${extra ? ` (${extra})` : ""}`;
}

export function fsmMessage(json: any, status: number): string {
  return describeZohoError(json, status, "Zoho FSM answered");
}

export type FsmContact = {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  company: { id: string; name: string } | null;
  /** Maher_Id__C, which this FSM account requires on a contact. */
  maherId: string | null;
  createdTime: string | null;
};

export type FsmAddress = {
  id: string;
  /** FSM's own code, "AD-6861". */
  code: string | null;
  /** The line the office knows it by, "DAMAC MERANO TOWER, 601". */
  label: string;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  createdTime: string | null;
};

const text = (value: unknown) => {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
};

export function mapContact(raw: Raw): FsmContact {
  const name =
    text(raw.Full_Name) ??
    [raw.First_Name, raw.Last_Name].map(text).filter(Boolean).join(" ") ??
    "";
  return {
    id: String(raw.id),
    name: name || text(raw.Email) || "Unnamed contact",
    email: text(raw.Email),
    mobile: text(raw.Mobile),
    phone: text(raw.Phone),
    company: raw.Company?.id ? { id: String(raw.Company.id), name: String(raw.Company.name ?? "") } : null,
    maherId: text(raw.Maher_Id__C),
    createdTime: text(raw.Created_Time),
  };
}

export function mapAddress(raw: Raw): FsmAddress {
  const street1 = text(raw.Street_1);
  return {
    id: String(raw.id),
    code: text(raw.Name),
    label: text(raw.Address_Name) ?? street1 ?? text(raw.Name) ?? "Address",
    street1,
    street2: text(raw.Street_2),
    city: text(raw.City),
    state: text(raw.State),
    country: text(raw.Country),
    zip: text(raw.Zip_Code),
    lat: typeof raw.Latitude === "number" ? raw.Latitude : null,
    lng: typeof raw.Longitude === "number" ? raw.Longitude : null,
    createdTime: text(raw.Created_Time),
  };
}

const newestFirst = (a: { createdTime: string | null }, b: { createdTime: string | null }) =>
  (b.createdTime ?? "").localeCompare(a.createdTime ?? "");

/** One page of contacts, newest first. */
export async function listContacts(
  token: string,
  { page, perPage }: { page: number; perPage: number },
): Promise<{ rows: FsmContact[]; hasMore: boolean }> {
  const res = await fsmFetch(
    token,
    `/Contacts?page=${page + 1}&per_page=${perPage}&sort_by=Created_Time&sort_order=desc`,
  );
  if (res.status === 204) return { rows: [], hasMore: false };
  if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
  return {
    rows: ((res.json?.data ?? []) as Raw[]).filter((c) => !c.$inactive).map(mapContact),
    hasMore: Boolean(res.json?.info?.more_records),
  };
}

/*
  The fields a search term is looked for in. FSM searches one field per
  call, so a term goes to the fields it could be: an email to Email, a
  number to Mobile and Phone (without its 0 / 971 prefix, which FSM stores
  in every form), anything else to the name and the email.
*/
function searchFields(term: string): [string, string][] {
  const digits = term.replace(/\D/g, "");
  if (term.includes("@")) return [["Email", term]];
  if (digits.length >= 4 && digits.length >= term.replace(/[\s()+-]/g, "").length) {
    const core = digits.replace(/^(00971|971|0)/, "") || digits;
    return [
      ["Mobile", core],
      ["Phone", core],
    ];
  }
  return [
    ["Last_Name", term],
    ["Email", term],
  ];
}

/** One page of contacts matching a term, merged across the fields searched. */
export async function searchContacts(
  token: string,
  term: string,
  { page, perPage }: { page: number; perPage: number },
): Promise<{ rows: FsmContact[]; hasMore: boolean }> {
  const results = await Promise.all(
    searchFields(term).map(async ([field, value]) => {
      // A comma in the value has to be escaped for FSM's search.
      const escaped = value.replace(/,/g, "\\,");
      const res = await fsmFetch(
        token,
        `/Contacts/search?api_name=${field}&value=${encodeURIComponent(escaped)}&comparator=contains&page=${page + 1}&per_page=${perPage}`,
      );
      if (res.status === 204) return { rows: [] as Raw[], more: false };
      if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
      return { rows: (res.json?.data ?? []) as Raw[], more: Boolean(res.json?.info?.more_records) };
    }),
  );
  const seen = new Set<string>();
  const rows: FsmContact[] = [];
  for (const raw of results.flatMap((r) => r.rows)) {
    if (raw.$inactive || seen.has(String(raw.id))) continue;
    seen.add(String(raw.id));
    rows.push(mapContact(raw));
  }
  return { rows: rows.sort(newestFirst), hasMore: results.some((r) => r.more) };
}

/** The contact with this exact email, if FSM has one. */
export async function findContactByEmail(token: string, email: string): Promise<FsmContact | null> {
  const res = await fsmFetch(
    token,
    `/Contacts/search?api_name=Email&value=${encodeURIComponent(email.trim())}&comparator=equal`,
  );
  if (res.status === 204) return null;
  if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
  const hit = ((res.json?.data ?? []) as Raw[]).find((c) => !c.$inactive);
  return hit ? mapContact(hit) : null;
}

export async function getContact(token: string, id: string): Promise<FsmContact | null> {
  const res = await fsmGetRecord<Raw>(token, "Contacts", id);
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
  return res.record ? mapContact(res.record) : null;
}

/** Every address on a contact, newest first. */
export async function listContactAddresses(token: string, contactId: string): Promise<FsmAddress[]> {
  const out: FsmAddress[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await fsmFetch(
      token,
      `/Contacts/${encodeURIComponent(contactId)}/Addresses?page=${page}&per_page=200`,
    );
    if (res.status === 204) break;
    if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
    for (const raw of (res.json?.data ?? []) as Raw[]) {
      if (!raw.$inactive) out.push(mapAddress(raw));
    }
    if (!res.json?.info?.more_records) break;
  }
  return out.sort(newestFirst);
}

/** The company with this name, found or created. */
export async function ensureCompany(
  token: string,
  name: string,
  /* A new company needs a Phone in this FSM account; the client's own
     number and email are what the portal has for it. */
  contact: { phone?: string | null; email?: string | null } = {},
): Promise<string> {
  const found = await fsmFetch(
    token,
    `/Companies/search?api_name=Company_Name&value=${encodeURIComponent(name.replace(/,/g, "\\,"))}&comparator=equal`,
  );
  const hit = found.ok ? ((found.json?.data ?? []) as Raw[])[0] : null;
  if (hit?.id) return String(hit.id);
  const created = await fsmFetch(
    token,
    "/Companies",
    {
      method: "POST",
      body: JSON.stringify({
        data: [
          {
            Company_Name: name,
            ...(contact.phone ? { Phone: contact.phone } : {}),
            ...(contact.email ? { Email: contact.email } : {}),
          },
        ],
      }),
    },
    { retry: false },
  );
  if (!created.ok) throw new FsmApiError(fsmMessage(created.json, created.status), created.status, created.json);
  const id = String(created.json?.data?.Companies?.[0]?.id ?? "");
  if (!id) throw new FsmApiError("Zoho FSM created the company but sent no id back", 502, created.json);
  return id;
}

/** A name as FSM keeps it: Last_Name is mandatory, First_Name optional. */
export function splitName(name: string): { First_Name?: string; Last_Name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { Last_Name: parts[0] ?? name.trim() };
  return { First_Name: parts[0], Last_Name: parts.slice(1).join(" ") };
}

export type FsmAddressInput = {
  street1: string;
  street2?: string | null;
  city?: string | null;
  /** The map pin, where the property has one. FSM keeps both as numbers. */
  lat?: number | null;
  lng?: number | null;
};

function addressBody(address: FsmAddressInput) {
  return {
    Address_Name: address.street1.slice(0, 250),
    Street_1: address.street1.slice(0, 250),
    Street_2: address.street2 ?? null,
    City: address.city ?? "Dubai",
    State: "Dubai",
    Country: "United Arab Emirates",
    ...(address.lat != null && address.lng != null
      ? { Latitude: String(address.lat), Longitude: String(address.lng) }
      : {}),
  };
}

/**
 * Corrects an address already on a contact, in place.
 *
 * The same PUT /Contacts/{id} that adds an address, with the address's id in
 * the Service_Address: FSM then updates that address rather than adding a
 * second one (checked against a test contact on 15 Oct 2026 -- the field
 * changed, the address count did not).
 */
export async function updateContactAddress(
  token: string,
  contactId: string,
  addressId: string,
  address: FsmAddressInput,
): Promise<void> {
  const res = await fsmFetch(token, `/Contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    body: JSON.stringify({ data: [{ Service_Address: { id: addressId, ...addressBody(address) } }] }),
  });
  if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
}

/** Creates a contact (POST /Contacts: Last_Name and Email are mandatory). */
export async function createContact(
  token: string,
  input: {
    name: string;
    email: string;
    mobile?: string | null;
    companyId?: string | null;
    /* Required by this FSM account on every contact (Maher_Id__C); asked for
       as its own field when a client is added (Sami, Oct 2026). */
    maherId?: string | null;
    address?: FsmAddressInput | null;
  },
): Promise<string> {
  const body = {
    data: [
      {
        ...splitName(input.name),
        Email: input.email.trim(),
        // FSM requires Phone on a contact; the portal has one number, so it fills both.
        ...(input.mobile ? { Mobile: input.mobile, Phone: input.mobile } : {}),
        ...(input.maherId ? { Maher_Id__C: input.maherId.trim() } : {}),
        ...(input.companyId ? { Company: input.companyId } : {}),
        ...(input.address
          ? { Service_Address: addressBody(input.address), Billing_Address: "$SUBLOOKUP_Service_Address" }
          : {}),
      },
    ],
  };
  const res = await fsmFetch(token, "/Contacts", { method: "POST", body: JSON.stringify(body) }, { retry: false });
  if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
  const id = String(res.json?.data?.Contacts?.[0]?.id ?? "");
  if (!id) throw new FsmApiError("Zoho FSM created the contact but sent no id back", 502, res.json);
  return id;
}

/** Edits a contact (PUT /Contacts/{id}): only the fields given change. */
export async function updateContact(
  token: string,
  id: string,
  fields: {
    name?: string;
    email?: string | null;
    mobile?: string | null;
    companyId?: string | null;
    maherId?: string | null;
  },
): Promise<void> {
  const data: Raw = {};
  if (fields.name !== undefined) Object.assign(data, splitName(fields.name));
  if (fields.email !== undefined && fields.email) data.Email = fields.email.trim();
  if (fields.mobile !== undefined && fields.mobile) {
    data.Mobile = fields.mobile;
    data.Phone = fields.mobile;
  }
  if (fields.companyId !== undefined) data.Company = fields.companyId ?? null;
  // Never blanked: FSM requires it on a contact.
  if (fields.maherId !== undefined && fields.maherId) data.Maher_Id__C = fields.maherId.trim();
  if (Object.keys(data).length === 0) return;
  const res = await fsmFetch(token, `/Contacts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ data: [data] }),
  });
  if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
}

/**
 * Adds an address to a contact and returns the new address's id.
 *
 * FSM has no call for this: the address is sent as the contact's
 * Service_Address with no id, which FSM keeps as a new address (and makes
 * the contact's default service address). The new one is then found among
 * the contact's addresses, by its street line, newest first.
 */
export async function addContactAddress(
  token: string,
  contactId: string,
  address: FsmAddressInput,
): Promise<string> {
  const before = new Set((await listContactAddresses(token, contactId)).map((a) => a.id));
  const res = await fsmFetch(token, `/Contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    body: JSON.stringify({ data: [{ Service_Address: addressBody(address) }] }),
  });
  if (!res.ok) throw new FsmApiError(fsmMessage(res.json, res.status), res.status, res.json);
  const after = await listContactAddresses(token, contactId);
  const street = address.street1.trim().toLowerCase();
  const added =
    after.find((a) => !before.has(a.id) && (a.street1 ?? "").trim().toLowerCase() === street) ??
    after.find((a) => !before.has(a.id));
  if (!added) {
    throw new FsmApiError(
      "Zoho FSM accepted the address but no new address appeared on the contact",
      502,
      res.json,
    );
  }
  return added.id;
}
