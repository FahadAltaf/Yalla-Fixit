import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Saves the portal's appearance (theme and colours).
 *
 * The page used to write the settings row straight through /api/graphql,
 * which runs as the anonymous role -- the same open access that exposed the
 * Zoho token in that row. Browsers no longer write the table at all
 * (migration 20261005160000); this route does it with the service role for
 * anyone who can open Settings -> Appearance, and returns only the public
 * columns.
 */

/* What the browser may read back: the columns granted to anon/authenticated
   by 20261005160000. Never the OAuth token. */
const PUBLIC_SETTINGS_COLUMNS =
  "id, site_name, site_image, appearance_theme, primary_color, secondary_color, logo_url, favicon_url, logo_setting, site_description, meta_keywords, contact_email, social_links, created_at, logo_horizontal_url, updated_at, type";

const colour = z
  .string()
  .trim()
  .max(32)
  .regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z0-9(),.%\s-]+)$/, "Not a colour");

const appearanceSchema = z
  .object({
    appearance_theme: z.enum(["light", "dark", "system"]).optional(),
    primary_color: colour.optional(),
    secondary_color: colour.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export async function PUT(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.SETTINGS, ActionType.VIEW);
  if (!gate.ok) return gate.response;

  const parsed = appearanceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid appearance settings" },
      { status: 400 },
    );
  }

  const admin = await createAdminServerClient();
  const { data, error } = await admin
    .from("settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    /* The row the portal reads (settingsService.getSettingsById). */
    .eq("type", "admin")
    .select(PUBLIC_SETTINGS_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("Appearance settings update failed:", error.message);
    return NextResponse.json({ error: "Could not save the appearance settings" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Settings not found" }, { status: 404 });
  }
  return NextResponse.json({ settings: data });
}
