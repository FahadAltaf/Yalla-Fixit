import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { listClients, toOption } from "@/lib/server/snagging/client-list";
import { hasColumn } from "@/lib/server/snagging/columns";
import {
  createClientWithFsm,
  fsmClientsReady,
  fsmErrorMessage,
  updateClientWithFsm,
} from "@/lib/server/snagging/fsm-clients";
import { CLIENT_PHONE_REQUIRED, isUsablePhone } from "@/lib/snagging/client-phone";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Clients — for the new-job picker, and for the Clients page.
 *
 * Clients are their own record now (`snagging_clients`), reused across
 * jobs. GET searches them; POST creates one when the coordinator adds
 * someone new from the "+" dialog; PATCH edits one.
 *
 * PATCH exists because a client could only be created, never corrected: a
 * phone number typed wrong in the job wizard stayed wrong on every
 * quotation and every job that client ever had, and the only way to change
 * it was to make a second client (BA v2, change 8 / FR-1.11).
 *
 * The response keeps the client_name/client_email/client_phone shape the
 * wizard already reads, plus the id so a picked client can be linked by id.
 */


export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    /*
      The Clients page's own permission, not Snagging as a whole.
      The page guard alone only stops the page: this endpoint is a
      URL like any other, and a role without the page could still
      call it and read every row.
    */
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING_CLIENTS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    return NextResponse.json(await listClients(admin, req.nextUrl.searchParams));
  } catch (error) {
    console.error("Snagging clients GET error:", error);
    return NextResponse.json(
      { error: "Failed to load clients" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.client_name ?? body?.name ?? "").trim();
    if (name.length < 2) {
      return NextResponse.json(
        { error: "Client name is required" },
        { status: 400 },
      );
    }
    const email = emptyToNull(body?.client_email ?? body?.email);
    const phone = emptyToNull(body?.client_phone ?? body?.phone);
    const company = emptyToNull(body?.company);
    // Zoho FSM requires a Maher ID on a contact (Sami, Oct 2026: its own input).
    const maherId = emptyToNull(body?.maher_id);
    // Required wherever a client is saved, as on the quotation form (SNG-008).
    if (!isUsablePhone(phone)) {
      return NextResponse.json({ error: CLIENT_PHONE_REQUIRED }, { status: 400 });
    }

    const admin = await createAdminServerClient();

    /*
      With Zoho FSM as the client record (Sami, 14 Oct 2026), a new client
      is created there and in the portal. FSM requires an email on a
      contact, and one it already has is linked rather than duplicated.
    */
    if (await fsmClientsReady(admin)) {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          { error: "An email is required: Zoho FSM keeps every client with one." },
          { status: 400 },
        );
      }
      if (!maherId) {
        return NextResponse.json(
          { error: "A Maher ID is required: Zoho FSM keeps every client with one." },
          { status: 400 },
        );
      }
      try {
        const { client, existed } = await createClientWithFsm(
          admin,
          { name, email, phone, company, maherId },
          profile.id,
        );
        return NextResponse.json({ data: client, existed }, { status: existed ? 200 : 201 });
      } catch (err) {
        return NextResponse.json({ error: fsmErrorMessage(err) }, { status: 502 });
      }
    }

    // Reuse a matching client (same name + email) rather than piling up
    // duplicates when the same person is added twice.
    const { data: existing } = await admin
      .from("snagging_clients")
      .select("id, name, email, phone, company")
      .ilike("name", name)
      .limit(20);
    const match = (existing ?? []).find(
      (c) => (c.email ?? "").toLowerCase() === (email ?? "").toLowerCase(),
    );
    if (match) {
      return NextResponse.json({ data: toOption(match) }, { status: 200 });
    }

    const { data, error } = await admin
      .from("snagging_clients")
      .insert({ name, email, phone, company, created_by: profile.id })
      .select("id, name, email, phone, company")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: toOption(data) }, { status: 201 });
  } catch (error) {
    console.error("Snagging clients POST error:", error);
    return NextResponse.json(
      { error: "Failed to save client" },
      { status: 500 },
    );
  }
}

/**
 * Corrects a client's details (BA v2, change 8 / FR-1.11).
 *
 * Only the fields actually sent are touched, so editing a phone number
 * from the Clients page cannot blank a company nobody typed into that
 * form. The name is the one field that may not be emptied — every
 * quotation and job header prints it.
 *
 * Quotations are unaffected by design: each one snapshots the client's
 * details at the moment it was raised, so a corrected number appears on
 * the next document rather than silently rewriting one already issued.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "").trim();
    // A client listed from Zoho FSM that the portal has not used yet has no id of its own.
    const fsmContactId = String(body?.fsm_contact_id ?? "").trim();
    if (!id && !fsmContactId) {
      return NextResponse.json({ error: "Which client?" }, { status: 400 });
    }

    const updates: Record<string, string | null> = {};
    const sent = (...keys: string[]) =>
      keys.find((key) => body?.[key] !== undefined);

    const nameKey = sent("client_name", "name");
    if (nameKey) {
      const name = String(body[nameKey] ?? "").trim();
      if (name.length < 2) {
        return NextResponse.json(
          { error: "Client name is required" },
          { status: 400 },
        );
      }
      updates.name = name;
    }

    const emailKey = sent("client_email", "email");
    if (emailKey) updates.email = emptyToNull(body[emailKey]);
    const phoneKey = sent("client_phone", "phone");
    if (phoneKey) {
      // A client cannot be left without a phone (SNG-008).
      if (!isUsablePhone(body[phoneKey])) {
        return NextResponse.json({ error: CLIENT_PHONE_REQUIRED }, { status: 400 });
      }
      updates.phone = emptyToNull(body[phoneKey]);
    }
    if (body?.company !== undefined)
      updates.company = emptyToNull(body.company);
    if (body?.notes !== undefined) updates.notes = emptyToNull(body.notes);
    if (body?.maher_id !== undefined) updates.maher_id = emptyToNull(body.maher_id);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }

    const admin = await createAdminServerClient();

    // The FSM contact is the record: corrected there first, then the portal's copy.
    if (await fsmClientsReady(admin)) {
      try {
        const data = await updateClientWithFsm(
          admin,
          { id: id || null, fsmContactId: fsmContactId || null },
          {
            ...(updates.name !== undefined ? { name: updates.name as string } : {}),
            ...(updates.email !== undefined ? { email: updates.email } : {}),
            ...(updates.phone !== undefined ? { phone: updates.phone } : {}),
            ...(updates.company !== undefined ? { company: updates.company } : {}),
            ...(updates.maher_id !== undefined ? { maherId: updates.maher_id } : {}),
            ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
          },
          profile.id,
        );
        return NextResponse.json({ data });
      } catch (err) {
        return NextResponse.json({ error: fsmErrorMessage(err) }, { status: 502 });
      }
    }
    if (!id) {
      return NextResponse.json({ error: "Which client?" }, { status: 400 });
    }
    // Kept only once its column is there (20261015120000_snagging_client_maher_id).
    if (updates.maher_id !== undefined && !(await hasColumn(admin, "snagging_clients", "maher_id"))) {
      delete updates.maher_id;
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await admin
      .from("snagging_clients")
      .update(updates)
      .eq("id", id)
      .select("id, name, email, phone, company, notes, created_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({ data: toOption(data) });
  } catch (error) {
    console.error("Snagging clients PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to save client" },
      { status: 500 },
    );
  }
}

function emptyToNull(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}
