import { NextRequest } from "next/server";
import { ActionType, ResourceType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { intParam, ok, serverError } from "@/lib/server/compliance/http";

/*
  Active portal users for the settings pickers (deactivation-request
  recipients now, reminder recipients and identity viewers later). Names
  and emails only; read through the service-role client, never GraphQL.
*/
export async function GET(req: NextRequest) {
  const g = await requireCompliance(ActionType.VIEW, ResourceType.COMPLIANCE_SETTINGS);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    // Only letters, digits, spaces, @ . - are kept: PostgREST filter syntax uses , ( ) " and the
    // pattern characters % _ , none of which belong in a name or email search.
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[^\p{L}\p{N} @.\-]/gu, "").slice(0, 80);
    const limit = intParam(req.nextUrl.searchParams.get("limit"), 50, 1, 200);
    let query = admin
      .from("user_profile")
      .select("id, email, full_name, first_name, last_name, is_active")
      .or("is_active.is.null,is_active.eq.true")
      .not("email", "is", null)
      .order("full_name", { ascending: true })
      .limit(limit);
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const users = (data ?? [])
      .filter((u: { email: string | null }) => Boolean(u.email))
      .map((u: { id: string; email: string; full_name: string | null; first_name: string | null; last_name: string | null }) => ({
        id: u.id,
        email: u.email,
        name: (u.full_name && u.full_name.trim()) || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
      }));
    return ok(users);
  } catch (error) {
    return serverError("portal users", error);
  }
}
