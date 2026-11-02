import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { LOOKUP_KEYS } from "@/lib/server/attribute-list-route";
import { ActionType, ResourceType, type User } from "@/types/types";

/*
  Leave for employees NOT in FSM (Sami, 31 Oct 2026). Stored in
  employee_leave_records and shown on the Workforce profile only; the
  scheduling board never reads it. An employee linked to an FSM technician
  takes leave through Scheduling's route instead, so the board sees it, and
  this route refuses new leave for them.

  Rights: seeing it needs Scheduling View or Compliance View (as People);
  adding needs Scheduling Create or Compliance Edit; cancelling needs
  Scheduling Edit or Compliance Edit.
*/
const createSchema = z
  .object({
    employeeId: z.string().uuid(),
    leaveType: z.string().trim().min(1),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    notes: z.string().trim().optional().nullable(),
  })
  .refine((d) => new Date(d.endAt) >= new Date(d.startAt), { message: "Leave end must not be earlier than leave start", path: ["endAt"] });

const cancelSchema = z.object({ id: z.string().uuid(), status: z.literal("cancelled") });

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

const can = (user: User, scheduling: ActionType, compliance: ActionType) =>
  hasResourceAction(user, ResourceType.SCHEDULING, scheduling) || hasResourceAction(user, ResourceType.COMPLIANCE, compliance);

async function guard(scheduling: ActionType, compliance: ActionType) {
  const { profile, accessUser } = await getAuthenticatedUserAccess();
  if (!profile || !accessUser) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (profile.is_active === false || !can(accessUser, scheduling, compliance)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { profileId: profile.id as string };
}

const normalise = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

// The same managed list as Scheduling's leave (lookup_options 'leave_type').
async function leaveTypes(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from("lookup_options").select("name, sort_order").eq("list_key", LOOKUP_KEYS.leaveType).order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { name: string }) => r.name);
}

export async function GET(req: NextRequest) {
  const g = await guard(ActionType.VIEW, ActionType.VIEW);
  if (g.error) return g.error;
  // ?current=1: active leave not yet ended, for every employee (People's
  // "On leave" filter). Otherwise one employee's whole history.
  if (req.nextUrl.searchParams.get("current") === "1") {
    try {
      const admin = await createAdminServerClient();
      const { data, error } = await admin
        .from("employee_leave_records")
        .select("id, employee_id, leave_type, start_at, end_at, status")
        .eq("status", "active")
        .gte("end_at", new Date().toISOString());
      if (error) throw new Error(error.message);
      return NextResponse.json({ data: data ?? [] });
    } catch (error) {
      console.error("Workforce leave GET current error:", error);
      return NextResponse.json({ error: "Failed to load leave" }, { status: 500 });
    }
  }
  const employeeId = req.nextUrl.searchParams.get("employeeId");
  if (!employeeId || !z.string().uuid().safeParse(employeeId).success) {
    return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
  }
  try {
    const admin = await createAdminServerClient();
    const [{ data, error }, types] = await Promise.all([
      admin.from("employee_leave_records").select("*").eq("employee_id", employeeId).order("start_at", { ascending: false }),
      leaveTypes(admin),
    ]);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: { records: data ?? [], leave_types: types } });
  } catch (error) {
    console.error("Workforce leave GET error:", error);
    return NextResponse.json({ error: "Failed to load leave" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await guard(ActionType.CREATE, ActionType.EDIT);
  if (g.error) return g.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid leave" }, { status: 400 });
  const body = parsed.data;
  try {
    const admin = await createAdminServerClient();
    const { data: employee, error: empError } = await admin
      .from("compliance_employees")
      .select("id, fsm_resource_id, archived_at")
      .eq("id", body.employeeId)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    if (employee.fsm_resource_id) {
      return NextResponse.json(
        { error: "This employee is linked to an FSM technician. Add the leave from the technician's Leave tab so the schedule board sees it." },
        { status: 409 },
      );
    }
    const type = (await leaveTypes(admin)).find((t) => normalise(t) === normalise(body.leaveType));
    if (!type) {
      return NextResponse.json({ error: `"${body.leaveType}" is not on the leave types list. Add it under Settings → Workforce → Leave types.` }, { status: 400 });
    }
    const { data, error } = await admin
      .from("employee_leave_records")
      .insert({
        employee_id: body.employeeId,
        leave_type: type,
        start_at: body.startAt,
        end_at: body.endAt,
        notes: body.notes || null,
        created_by: g.profileId,
        updated_by: g.profileId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error("Workforce leave POST error:", error);
    return NextResponse.json({ error: "Failed to save leave" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const g = await guard(ActionType.EDIT, ActionType.EDIT);
  if (g.error) return g.error;
  const parsed = cancelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Only cancelling is supported" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("employee_leave_records")
      .update({ status: "cancelled", cancelled_by: g.profileId, cancelled_at: now, updated_by: g.profileId, updated_at: now })
      .eq("id", parsed.data.id)
      .eq("status", "active")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Leave not found or already cancelled" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Workforce leave PATCH error:", error);
    return NextResponse.json({ error: "Failed to cancel leave" }, { status: 500 });
  }
}
