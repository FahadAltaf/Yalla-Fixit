import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { customerProfileFields } from "@/lib/amc/client-profile";
import { contactProblem, readContactInput } from "@/lib/clients/client-input";
import { getCustomer, updateCustomer } from "@/lib/server/amc/business";
import { recordLifecycleChange } from "@/lib/server/amc/client-profile";
import { clientsErrorResponse, requireClientsAccess } from "@/lib/server/clients/gate";
import { clientsWriteToFsm, readClient, saveClientContact } from "@/lib/server/clients/record";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* AMC's own fields, as AMC's client form sends them. */
const amcFieldsSchema = z
  .object({
    customerRef: z.string().trim().max(60).nullable().optional(),
    customerType: customerProfileFields.customerType,
    lifecycle: customerProfileFields.lifecycle,
    tradeLicenseNo: customerProfileFields.tradeLicenseNo,
    tradeLicenseExpiry: customerProfileFields.tradeLicenseExpiry,
    trn: customerProfileFields.trn,
    preferredChannel: customerProfileFields.preferredChannel,
    preferredLanguage: customerProfileFields.preferredLanguage,
  })
  .strict();

/**
 * One client in the Clients module (26 Nov 2026).
 *
 * GET   the client as Edit client starts from it (FSM's current details),
 *       with what this person may change.
 * PATCH Edit client, the one form for AMC and Snagging: the contact details
 *       go to Zoho FSM and the portal; AMC's fields (sent only by someone
 *       who may change them) to the client's AMC profile.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireClientsAccess(req);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  try {
    const client = await readClient(gate.admin, id, { withAmc: gate.access.amc });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const [amcCanEdit, writesToFsm] = await Promise.all([gate.amcCanEdit(client.createdBy), clientsWriteToFsm(gate.admin)]);
    return NextResponse.json({
      client,
      canEditContact: gate.access.editViaSnagging || amcCanEdit,
      canEditAmc: amcCanEdit,
      /* Saved to Zoho FSM too, so FSM's required fields are required here. */
      savedInFsm: writesToFsm && Boolean(client.fsmContactId),
    });
  } catch (error) {
    return clientsErrorResponse(error, "Could not load the client");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireClientsAccess(req);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = readContactInput(body);
  try {
    const before = await readClient(gate.admin, id, { withAmc: false });
    if (!before) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const amcCanEdit = await gate.amcCanEdit(before.createdBy);
    if (!gate.access.editViaSnagging && !amcCanEdit) {
      return NextResponse.json({ error: "You cannot change this client." }, { status: 403 });
    }

    let amc: z.infer<typeof amcFieldsSchema> | null = null;
    if (body?.amc !== undefined && body.amc !== null) {
      if (!amcCanEdit) {
        return NextResponse.json({ error: "Only the person who added this client, an AMC approver or AMC Operations can change its AMC details." }, { status: 403 });
      }
      const parsed = amcFieldsSchema.safeParse(body.amc);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the AMC details." }, { status: 400 });
      amc = parsed.data;
    }

    const savedInFsm = (await clientsWriteToFsm(gate.admin)) && Boolean(before.fsmContactId);
    const problem = contactProblem(input, { savedInFsm });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    /* The contact details: Zoho FSM first (it is the record), then the portal. */
    await saveClientContact(gate.admin, id, input, gate.userId);

    /* AMC's fields on its profile, with the status change recorded (BRD 5.9 / 6.9). */
    if (amc) {
      const actor = { id: gate.userId, label: gate.label };
      const was = amc.lifecycle ? (await getCustomer(gate.admin, id)).lifecycle : null;
      await updateCustomer(
        gate.admin,
        id,
        { name: input.name, email: input.email, phone: input.phone, company: input.company, notes: input.notes, ...amc },
        actor,
      );
      if (was && amc.lifecycle && was !== amc.lifecycle) await recordLifecycleChange(gate.admin, id, was, amc.lifecycle, actor);
    }

    return NextResponse.json({ client: await readClient(gate.admin, id, { withAmc: gate.access.amc }) });
  } catch (error) {
    return clientsErrorResponse(error, "Could not save the client");
  }
}
