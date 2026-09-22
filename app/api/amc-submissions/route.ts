import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { hasResourceAction } from "@/lib/role-permissions";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { isAmcSubmissionEditable } from "@/components/dashboard/extensions/amc/amc-types";
import { ActionType, ResourceType } from "@/types/types";
import type {
  AmcDocumentType,
  AmcSubmission,
  AmcSubmissionStatus,
} from "@/components/dashboard/extensions/amc/amc-types";

const DOCUMENT_TYPES = ["proposal", "contract"] as const;

const coordinationContactSchema = z.object({
  name: z.string(),
  phone: z.string(),
  designation: z.enum(["owner", "tenant", "representative"]),
});

const serviceRowSchema = z.object({
  serviceId: z.string(),
  included: z.boolean(),
  units: z.number().int().min(1),
  frequency: z.number().int().min(1),
  /* FR2.4. Nullable: a draft row the team has not priced yet is saved
     unpriced, and must not come back as a free service. */
  basePrice: z.number().min(0).nullable().optional(),
  price: z.number().min(0).optional(),
});

const priceListRowSchema = z.object({
  category: z.string(),
  description: z.string(),
  brand: z.string(),
  price: z.string(),
});

const accountManagerSchema = z.object({
  name: z.string(),
  phone: z.string(),
});

const submissionPayloadSchema = z.object({
  property: z.object({
    propertyCategory: z.enum(["residential", "commercial"]),
    unitType: z.enum(["villa", "apartment", "office"]),
    propertyAddress: z.string(),
    propertyDetail: z.string(),
  }),
  customer: z.object({
    customerName: z.string(),
    customerId: z.string().optional(),
    customerPhone: z.string(),
    customerEmail: z.string(),
    coordinationContacts: z.tuple([coordinationContactSchema, coordinationContactSchema]),
    startDate: z.string(),
    endDate: z.string(),
    paymentTerms: z.enum(["monthly", "quarterly", "annual"]),
    proposalNumber: z.string(),
  }),
  /* FR3.1/FR4.5/FR4.6. Optional on the payload so a submission saved
     before these existed still validates on update. */
  document_options: z
    .object({
      optionalSections: z.object({
        supplyInstallPriceList: z.boolean(),
        additionalFixedPriceServices: z.boolean(),
      }),
      priceListRows: z.array(priceListRowSchema),
      accountManagers: z.tuple([accountManagerSchema, accountManagerSchema]),
    })
    .optional(),
  services: z.array(serviceRowSchema),
  discount_percent: z.number().min(0).max(100),
  discount_amount: z.number().min(0),
  final_price: z.number().min(0),
  generated_documents: z.array(z.enum(DOCUMENT_TYPES)).optional(),
});

const submissionUpdateSchema = submissionPayloadSchema.partial().extend({
  id: z.string().uuid(),
});

type AmcSubmissionRow = {
  id: string;
  owner_id: string;
  /* Server-allocated from amc_proposal_number_seq (step 1.7). */
  proposal_number: string;
  status: AmcSubmissionStatus;
  property: AmcSubmission["property"];
  customer: AmcSubmission["customer"];
  document_options: AmcSubmission["document_options"];
  services: AmcSubmission["services"];
  discount_percent: number;
  discount_amount: number;
  final_price: number;
  generated_documents: AmcDocumentType[];
  settings_snapshot: AmcSubmission["settings_snapshot"];
  contract_settings_snapshot?: AmcSubmission["contract_settings_snapshot"];
  submitted_at: string | null;
  decided_at: string | null;
  sent_back_reason: string | null;
  /* Absent until the client-links migration is applied. */
  proposal_sent_at?: string | null;
  contract_sent_at?: string | null;
  client_decision?: "approved" | "rejected" | null;
  client_decided_at?: string | null;
  client_decided_by_name?: string | null;
  client_rejected_reason?: string | null;
  signed_by_name?: string | null;
  signed_at?: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(
  row: AmcSubmissionRow,
  owner?: { viewerId: string; names: Map<string, string> },
): AmcSubmission {
  return {
    ...(owner
      ? {
          owner_name: owner.names.get(row.owner_id) ?? null,
          is_own: row.owner_id === owner.viewerId,
        }
      : {}),
    id: row.id,
    owner_id: row.owner_id,
    status: row.status,
    property: row.property,
    customer: { ...row.customer, proposalNumber: row.proposal_number },
    document_options: row.document_options,
    services: row.services,
    discount_percent: Number(row.discount_percent),
    discount_amount: Number(row.discount_amount),
    final_price: Number(row.final_price),
    generated_documents: row.generated_documents ?? [],
    settings_snapshot: row.settings_snapshot ?? null,
    contract_settings_snapshot: row.contract_settings_snapshot ?? null,
    submitted_at: row.submitted_at ?? null,
    decided_at: row.decided_at ?? null,
    sent_back_reason: row.sent_back_reason ?? null,
    proposal_sent_at: row.proposal_sent_at ?? null,
    contract_sent_at: row.contract_sent_at ?? null,
    client_decision: row.client_decision ?? null,
    client_decided_at: row.client_decided_at ?? null,
    client_decided_by_name: row.client_decided_by_name ?? null,
    client_rejected_reason: row.client_rejected_reason ?? null,
    signed_by_name: row.signed_by_name ?? null,
    signed_at: row.signed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type AmcAccess = Awaited<ReturnType<typeof getAuthenticatedUserAccess>>;

type AmcAccessResult =
  | {
      ok: true;
      profile: NonNullable<AmcAccess["profile"]>;
      /* Carried through so the list route can check role_access for the
         approver queue (FR3.2/FR5.3) without a second lookup. */
      accessUser: NonNullable<AmcAccess["accessUser"]>;
    }
  | { ok: false; error: NextResponse };

async function requireAmcAccess(): Promise<AmcAccessResult> {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!canUseAmc(access.accessUser)) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, profile: access.profile, accessUser: access.accessUser };
}

export async function GET(req: NextRequest) {
  const gate = await requireAmcAccess();
  if (!gate.ok) return gate.error;

  const { profile } = gate;
  const admin = await createAdminServerClient();
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const { data, error } = await admin
      .from("amc_submissions")
      .select("*")
      .eq("id", id)
      .eq("owner_id", profile.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(mapRow(data as AmcSubmissionRow));
  }

  /*
    FR3.2: "My AMC Submissions shows each user their own submissions. The
    approver also sees every submission sent for review." An approver sees
    them through the whole life of the proposal, not only while it waits:
    what they approved, sent back, and what the client did with it. Other
    people's drafts stay private.

    Two reads rather than one `or` filter: the owner clause and the
    approver clause select on different columns, and an `or` spanning
    both is easy to get subtly wrong in a way that leaks drafts. Union by
    id here instead, where the intent is legible.
  */
  /* FR5.3: the approvers chosen in AMC Settings, or the role permission
     when none are chosen. */
  const canApprove = canApproveAmc(
    await readAmcSettings(admin),
    profile.email,
    hasResourceAction(gate.accessUser, ResourceType.AMC, ActionType.APPROVE),
  );

  const { data: own, error } = await admin
    .from("amc_submissions")
    .select("*")
    .eq("owner_id", profile.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = [...((own ?? []) as AmcSubmissionRow[])];

  if (canApprove) {
    const { data: queue, error: queueError } = await admin
      .from("amc_submissions")
      .select("*")
      .neq("owner_id", profile.id)
      .neq("status", "draft")
      .order("updated_at", { ascending: false });

    if (queueError) {
      return NextResponse.json({ error: queueError.message }, { status: 500 });
    }

    const seen = new Set(rows.map((row) => row.id));
    for (const row of (queue ?? []) as AmcSubmissionRow[]) {
      if (!seen.has(row.id)) rows.push(row);
    }
  }

  /* Waiting for approval first, then the most recently touched. */
  rows.sort((a, b) => {
    const waiting =
      Number(b.status === "awaiting_approval") -
      Number(a.status === "awaiting_approval");
    return waiting || b.updated_at.localeCompare(a.updated_at);
  });

  const ownerIds = [...new Set(rows.map((row) => row.owner_id))];
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await admin
      .from("user_profile")
      .select("id, full_name, email")
      .in("id", ownerIds);
    for (const owner of owners ?? []) {
      names.set(
        String(owner.id),
        ((owner.full_name as string | null) ?? "").trim() ||
          String(owner.email ?? ""),
      );
    }
  }

  const submissions = rows.map((row) =>
    mapRow(row, { viewerId: profile.id, names }),
  );
  return NextResponse.json({
    submissions,
    totalCount: submissions.length,
    canApprove,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireAmcAccess();
  if (!gate.ok) return gate.error;

  const { profile } = gate;
  const parsed = submissionPayloadSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const admin = await createAdminServerClient();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("amc_submissions")
    .insert({
      owner_id: profile.id,
      /* Always draft. It advances only through the approval route. */
      status: "draft",
      property: payload.property,
      customer: payload.customer,
      document_options: payload.document_options,
      services: payload.services,
      discount_percent: payload.discount_percent,
      discount_amount: payload.discount_amount,
      final_price: payload.final_price,
      generated_documents: payload.generated_documents ?? [],
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(mapRow(data as AmcSubmissionRow), { status: 201 });
}

export async function PUT(req: NextRequest) {
  const gate = await requireAmcAccess();
  if (!gate.ok) return gate.error;

  const { profile } = gate;
  const parsed = submissionUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id, ...updates } = parsed.data;
  const admin = await createAdminServerClient();

  const { data: existing, error: fetchError } = await admin
    .from("amc_submissions")
    .select("*")
    .eq("id", id)
    .eq("owner_id", profile.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existingRow = existing as AmcSubmissionRow;

  /*
    FR3.4 — "Once it is sent for review it is locked, until it is approved
    or sent back." Enforced here and not only in the UI: the autosave
    fires on a timer, and a submission approved in another tab while this
    one still had the wizard open would otherwise be silently rewritten
    after the decision was made.
  */
  if (!isAmcSubmissionEditable(existingRow.status)) {
    return NextResponse.json(
      {
        error: `This proposal is ${existingRow.status.replace(/_/g, " ")} and can no longer be edited.`,
      },
      { status: 409 },
    );
  }
  const mergedDocuments = updates.generated_documents
    ? Array.from(
        new Set([
          ...(existingRow.generated_documents ?? []),
          ...updates.generated_documents,
        ]),
      )
    : existingRow.generated_documents;

  /* Pin the JSONB copy to the allocated number, whatever the form sent,
     so the two cannot drift apart through an edit. */
  if (updates.customer) {
    updates.customer = {
      ...updates.customer,
      proposalNumber: existingRow.proposal_number,
    };
  }

  const { data, error } = await admin
    .from("amc_submissions")
    .update({
      ...updates,
      generated_documents: mergedDocuments,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", profile.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(mapRow(data as AmcSubmissionRow));
}
