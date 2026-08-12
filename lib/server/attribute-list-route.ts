import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// Shared CRUD handlers for a managed lookup list (technician_roles /
// technician_service_types). Both have {id, name, sort_order} and a
// case-insensitive unique name (#16 no duplicates). `label` personalises the
// error/audit text; `foreignKey` is the technician_reference column pointing
// at this list, so a delete can report how many technicians it clears.
export function makeAttributeListRoute(opts: {
  table: "technician_roles" | "technician_service_types";
  foreignKey: "role_id" | "service_type_id";
  label: string;
}) {
  const nameSchema = z.object({ name: z.string().trim().min(1) });
  const updateSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1) });

  async function guard(action: ActionType) {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, action)) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { profile };
  }

  const dup = () => NextResponse.json({ error: `A ${opts.label} with this name already exists` }, { status: 409 });

  async function GET() {
    try {
      const g = await guard(ActionType.VIEW);
      if (g.error) return g.error;
      const admin = await createAdminServerClient();
      const { data: rows, error } = await admin
        .from(opts.table)
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);

      // Count technicians per list item so the manage dialog can warn on delete.
      const { data: techs } = await admin.from("technician_reference").select(opts.foreignKey);
      const counts = new Map<string, number>();
      (techs ?? []).forEach((t: Record<string, string | null>) => {
        const id = t[opts.foreignKey];
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      });

      const list = (rows ?? []).map((r: { id: string; name: string; sort_order: number }) => ({
        ...r,
        technician_count: counts.get(r.id) ?? 0,
      }));
      return NextResponse.json({ data: list });
    } catch (error) {
      console.error(`${opts.table} GET error:`, error);
      return NextResponse.json({ error: `Failed to load ${opts.label}s` }, { status: 500 });
    }
  }

  async function POST(req: NextRequest) {
    try {
      const g = await guard(ActionType.CREATE);
      if (g.error) return g.error;
      const parsed = nameSchema.safeParse(await req.json());
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      const admin = await createAdminServerClient();
      const { data, error } = await admin
        .from(opts.table)
        .insert({ name: parsed.data.name })
        .select("*")
        .single();
      if (error) return error.code === "23505" ? dup() : (() => { throw new Error(error.message); })();
      return NextResponse.json({ data: { ...data, technician_count: 0 } });
    } catch (error) {
      console.error(`${opts.table} POST error:`, error);
      return NextResponse.json({ error: `Failed to create ${opts.label}` }, { status: 500 });
    }
  }

  async function PUT(req: NextRequest) {
    try {
      const g = await guard(ActionType.EDIT);
      if (g.error) return g.error;
      const parsed = updateSchema.safeParse(await req.json());
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      const admin = await createAdminServerClient();
      const { data, error } = await admin
        .from(opts.table)
        .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
        .eq("id", parsed.data.id)
        .select("*")
        .single();
      if (error) return error.code === "23505" ? dup() : (() => { throw new Error(error.message); })();
      return NextResponse.json({ data });
    } catch (error) {
      console.error(`${opts.table} PUT error:`, error);
      return NextResponse.json({ error: `Failed to update ${opts.label}` }, { status: 500 });
    }
  }

  async function DELETE(req: NextRequest) {
    try {
      const g = await guard(ActionType.DELETE);
      if (g.error) return g.error;
      const id = req.nextUrl.searchParams.get("id");
      if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
      const admin = await createAdminServerClient();
      // FK is ON DELETE SET NULL, so technicians keep their row and just lose
      // this attribute.
      const { error } = await admin.from(opts.table).delete().eq("id", id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ data: { success: true } });
    } catch (error) {
      console.error(`${opts.table} DELETE error:`, error);
      return NextResponse.json({ error: `Failed to delete ${opts.label}` }, { status: 500 });
    }
  }

  return { GET, POST, PUT, DELETE };
}
