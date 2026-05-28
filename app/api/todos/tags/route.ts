import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";

const tagPayloadSchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

const tagUpdateSchema = tagPayloadSchema.extend({
  id: z.string().uuid(),
});

async function requireUser() {
  const sessionClient = await createServerClientForApi();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  try {
    const userId = await requireUser();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("todo_tags")
      .select("id,name,color,created_at,updated_at")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("Todo tags GET error:", error);
    return NextResponse.json({ error: "Failed to load tags" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = tagPayloadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("todo_tags")
      .insert({
        name: parsed.data.name,
        color: parsed.data.color,
      })
      .select("id,name,color,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Todo tags POST error:", error);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await requireUser();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = tagUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("todo_tags")
      .update({
        name: parsed.data.name,
        color: parsed.data.color,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.id)
      .select("id,name,color,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Todo tags PUT error:", error);
    return NextResponse.json({ error: "Failed to update tag" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireUser();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Tag ID is required" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { error } = await admin.from("todo_tags").delete().eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Todo tags DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete tag" }, { status: 500 });
  }
}
