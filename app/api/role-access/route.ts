import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const operation = searchParams.get("operation");
    const roleId = searchParams.get("roleId");
    const supabaseAdmin = await createAdminServerClient()

    switch (operation) {
      case "getByRole": {
        if (!roleId) {
          return NextResponse.json(
            { error: "Role ID is required" },
            { status: 400 }
          );
        }

        const { data, error } = await supabaseAdmin
          .from("role_access")
          .select("*")
          .eq("role_id", roleId);

        if (error) throw error;
        return NextResponse.json({ data: data || [] });
      }

      default:
        return NextResponse.json(
          { error: "Invalid operation" },
          { status: 400 }
        );
    }
  } catch (error: unknown) {
    console.error("Role Access API Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { operation, data } = await req.json();
    const supabaseAdmin = await createAdminServerClient()

    switch (operation) {
      case "create": {
        const { data: result, error } = await supabaseAdmin
          .from("role_access")
          .insert(data)
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ data: result });
      }

      case "bulkCreate": {
        const { data: result, error } = await supabaseAdmin
          .from("role_access")
          .insert(data)
          .select();

        if (error) throw error;
        return NextResponse.json({ data: result });
      }

      default:
        return NextResponse.json(
          { error: "Invalid operation" },
          { status: 400 }
        );
    }
  } catch (error: unknown) {
    console.error("Role Access API Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const roleId = searchParams.get("roleId");
    const supabaseAdmin = await createAdminServerClient()

    if (roleId) {
      // Delete all permissions for a role
      const { error } = await supabaseAdmin
        .from("role_access")
        .delete()
        .eq("role_id", roleId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (!id) {
      return NextResponse.json(
        { error: "ID is required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("role_access")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Role Access API Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

