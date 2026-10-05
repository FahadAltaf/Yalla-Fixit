// Zoho FSM Contacts reads, for linking an AMC contract to its FSM customer.
//
// Customer_Id__C is the org's custom customer number on a Contact (the
// estimates flow reads the same field, app/api/estimates/route.ts). Only
// the id, name and that number are returned: nothing else about the
// contact is needed or kept.

import { fsmGetRecord } from "./fsm-client";

export type FsmContactSummary = { id: string; name: string | null; customerId: string | null };

type ContactRecord = {
  id: string;
  Full_Name?: string | null;
  First_Name?: string | null;
  Last_Name?: string | null;
  Customer_Id__C?: string | null;
};

export async function getFsmContactSummary(
  token: string,
  contactId: string,
): Promise<{ ok: true; contact: FsmContactSummary } | { ok: false; status: number }> {
  const res = await fsmGetRecord<ContactRecord>(token, "Contacts", contactId);
  if (!res.ok || !res.record) return { ok: false, status: res.ok ? 404 : res.status };
  const r = res.record;
  const name = r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(" ") || null;
  const customerId = typeof r.Customer_Id__C === "string" && r.Customer_Id__C.trim() ? r.Customer_Id__C.trim() : null;
  return { ok: true, contact: { id: String(r.id), name, customerId } };
}
