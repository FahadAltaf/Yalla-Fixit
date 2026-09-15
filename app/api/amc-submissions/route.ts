import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessAmcContracts } from "@/components/dashboard/extensions/amc/amc-constants";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import type {
  AmcDocumentType,
  AmcSubmission,
  AmcSubmissionStatus,
} from "@/components/dashboard/extensions/amc/amc-types";

const DOCUMENT_TYPES = ["proposal", "contract"] as const;
const SUBMISSION_STATUSES = ["draft", "generated"] as const;

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
  status: z.enum(SUBMISSION_STATUSES).optional(),
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
  status: AmcSubmissionStatus;
  property: AmcSubmission["property"];
  customer: AmcSubmission["customer"];
  document_options: AmcSubmission["document_options"];
  services: AmcSubmission["services"];
  discount_percent: number;
  discount_amount: number;
  final_price: number;
  generated_documents: AmcDocumentType[];
  created_at: string;
  updated_at: string;
};

function mapRow(row: AmcSubmissionRow): AmcSubmission {
  return {
    id: row.id,
    owner_id: row.owner_id,
    status: row.status,
    property: row.property,
    customer: row.customer,
    document_options: row.document_options,
    services: row.services,
    discount_percent: Number(row.discount_percent),
    discount_amount: Number(row.discount_amount),
    final_price: Number(row.final_price),
    generated_documents: row.generated_documents ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type AmcAccessResult =
  | { ok: true; profile: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUserAccess>>["profile"]> }
  | { ok: false; error: NextResponse };

async function requireAmcAccess(): Promise<AmcAccessResult> {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!canAccessAmcContracts(access.profile.email)) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, profile: access.profile };
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

  const { data, error } = await admin
    .from("amc_submissions")
    .select("*")
    .eq("owner_id", profile.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const submissions = ((data ?? []) as AmcSubmissionRow[]).map(mapRow);
  return NextResponse.json({
    submissions,
    totalCount: submissions.length,
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
      status: payload.status ?? "draft",
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
  const mergedDocuments = updates.generated_documents
    ? Array.from(
        new Set([
          ...(existingRow.generated_documents ?? []),
          ...updates.generated_documents,
        ]),
      )
    : existingRow.generated_documents;

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
