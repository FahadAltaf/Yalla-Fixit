// Certificate types (FRD FR-1, D5, D6): a managed list with an "expires"
// flag. Retired, never deleted.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CertificateType } from "@/lib/compliance/types";

const COLUMNS = "id, name, expires, sort_order, is_active";

export async function listCertificateTypes(admin: SupabaseClient, includeInactive = true): Promise<CertificateType[]> {
  let q = admin.from("compliance_certificate_types").select(COLUMNS).order("sort_order", { ascending: true }).order("name", { ascending: true });
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as CertificateType[];
}

export async function createCertificateType(
  admin: SupabaseClient,
  input: { name: string; expires: boolean; sort_order?: number },
  actorId: string,
): Promise<CertificateType | "duplicate"> {
  const { data, error } = await admin
    .from("compliance_certificate_types")
    .insert({ name: input.name, expires: input.expires, sort_order: input.sort_order ?? 100, created_by: actorId, updated_by: actorId })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(error.message);
  }
  return data as CertificateType;
}

export async function updateCertificateType(
  admin: SupabaseClient,
  id: string,
  patch: Partial<Pick<CertificateType, "name" | "expires" | "sort_order" | "is_active">>,
  actorId: string,
): Promise<{ before: CertificateType; after: CertificateType } | "duplicate" | "missing"> {
  const { data: before, error: readError } = await admin.from("compliance_certificate_types").select(COLUMNS).eq("id", id).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!before) return "missing";
  const { data: after, error } = await admin
    .from("compliance_certificate_types")
    .update({ ...patch, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(error.message);
  }
  return { before: before as CertificateType, after: after as CertificateType };
}
