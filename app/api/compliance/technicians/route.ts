import { NextRequest } from "next/server";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireComplianceAny } from "@/lib/server/compliance/access";
import { intParam, ok, serverError } from "@/lib/server/compliance/http";
import type { TechnicianOption } from "@/lib/compliance/types";

/*
  FSM technicians to link an employee to (FRD D3, D11). Shows who is
  already linked so the same technician is never used twice (the database
  also refuses it).
*/
export async function GET(req: NextRequest) {
  const g = await requireComplianceAny([ActionType.CREATE, ActionType.EDIT]);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const limit = intParam(req.nextUrl.searchParams.get("limit"), 30, 1, 200);
    type Row = { fsm_resource_id: string; display_name: string; is_active: boolean; deactivated_at?: string | null };
    const load = async (columns: string) => {
      let query = admin.from("technician_reference").select(columns).order("display_name", { ascending: true }).limit(limit);
      if (q) query = query.ilike("display_name", `%${q.replace(/[%_]/g, "")}%`);
      const { data, error } = await query;
      return { rows: (data ?? []) as unknown as Row[], error };
    };
    let result = await load("fsm_resource_id, display_name, is_active, deactivated_at");
    // deactivated_at arrives with migration 20261020130000; tolerate its absence.
    if (result.error && (result.error.code === "42703" || result.error.code === "PGRST204")) {
      result = await load("fsm_resource_id, display_name, is_active");
    }
    if (result.error) throw new Error(result.error.message);
    const rows = result.rows;
    const ids = rows.map((r) => r.fsm_resource_id);
    const linked = new Map<string, string>();
    if (ids.length) {
      const { data: links } = await admin.from("compliance_employees").select("fsm_resource_id, maher_id").in("fsm_resource_id", ids);
      (links ?? []).forEach((l: { fsm_resource_id: string | null; maher_id: string }) => {
        if (l.fsm_resource_id) linked.set(l.fsm_resource_id, l.maher_id);
      });
    }
    const options: TechnicianOption[] = rows.map((r) => ({
      fsm_resource_id: r.fsm_resource_id,
      display_name: r.display_name,
      is_active: r.is_active,
      deactivated_at: r.deactivated_at ?? null,
      linked_to: linked.get(r.fsm_resource_id) ?? null,
    }));
    return ok(options);
  } catch (error) {
    return serverError("technician options", error);
  }
}
