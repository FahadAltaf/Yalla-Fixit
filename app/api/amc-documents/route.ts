import { NextRequest, NextResponse } from "next/server";

import { AMC_DOCUMENT_MAX_BYTES, DOCUMENT_LEVELS, documentMetaSchema, type DocumentLevel } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { listDocuments, uploadDocument, type DocumentRecord } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess, requireManagedContract, type ContractGate } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/**
 * The AMC document store (BRD 5.9, DEV-381): files per client, property and
 * contract (visits, enquiries and call outs in later phases), in the private
 * amc-documents bucket, with category, version, date, uploader and expiry.
 *
 * GET  ?level=&entityId=   one record's documents
 *      ?customerId=        everything that rolls up to a client
 * POST multipart: file + level, entityId, category, title, expiresOn?, notes?
 *
 * Access follows the record: clients and properties as their own rules
 * (read: AMC users; upload: creator, approver, AMC Operations Edit);
 * contract documents as the contract (read / operate).
 */

type Gate = Extract<ContractGate, { ok: true }>;

/** Which client a record rolls up to, after checking the caller may read (or write) it. */
async function authorise(
  gate: Gate,
  level: DocumentLevel,
  entityId: string,
  mode: "read" | "write",
): Promise<{ ok: true; customerId: string | null } | { ok: false; response: NextResponse }> {
  if (level === "customer") {
    if (mode === "write") {
      const refused = await refuseCustomerEdit(gate, "customers", entityId);
      if (refused) return { ok: false, response: refused };
    }
    return { ok: true, customerId: entityId };
  }
  if (level === "property") {
    if (mode === "write") {
      const refused = await refuseCustomerEdit(gate, "customer_properties", entityId);
      if (refused) return { ok: false, response: refused };
    }
    const { data } = await gate.admin.from("amc_property_directory").select("customer_id").eq("id", entityId).maybeSingle<{ customer_id: string | null }>();
    if (!data) return { ok: false, response: NextResponse.json({ error: "Property not found." }, { status: 404 }) };
    return { ok: true, customerId: data.customer_id };
  }
  if (level === "contract") {
    const managed = await requireManagedContract(gate, entityId, mode);
    if (!managed.ok) return managed;
    const { data } = await gate.admin.from("amc_contracts").select("customer_id").eq("id", entityId).maybeSingle<{ customer_id: string | null }>();
    return { ok: true, customerId: data?.customer_id ?? null };
  }
  if (level === "proposal") {
    /* Phase 5: a proposal's documents (the client's decision evidence). Read as the proposal is read;
       written by its owner, an approver, or AMC Operations (Edit). */
    const { data } = await gate.admin
      .from("amc_submissions")
      .select("owner_id, status, customer_id")
      .eq("id", entityId)
      .maybeSingle<{ owner_id: string; status: string; customer_id: string | null }>();
    const notFound = { ok: false as const, response: NextResponse.json({ error: "Proposal not found." }, { status: 404 }) };
    if (!data) return notFound;
    const isOwner = data.owner_id === gate.userId;
    const canRead = isOwner || ((gate.canApprove || gate.actor.ops.view) && data.status !== "draft");
    const canWrite = isOwner || gate.canApprove || gate.actor.ops.edit;
    if (!(mode === "read" ? canRead : canWrite)) return notFound;
    return { ok: true, customerId: data.customer_id };
  }
  return { ok: false, response: NextResponse.json({ error: "Documents for this kind of record arrive in a later phase." }, { status: 400 }) };
}

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  try {
    const customerId = params.get("customerId");
    if (customerId) {
      if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
      const result = await listDocuments(gate.admin, { customerId });
      /* A client's page lists contract documents only for contracts the caller may open. */
      const visible: DocumentRecord[] = [];
      for (const doc of result.documents) {
        if (doc.level !== "contract" || gate.seesAll) visible.push(doc);
        else if ((await requireManagedContract(gate, doc.entityId, "read")).ok) visible.push(doc);
      }
      return NextResponse.json({ ...result, documents: visible }, { headers: { "Cache-Control": "no-store" } });
    }
    const level = params.get("level") as DocumentLevel | null;
    const entityId = params.get("entityId") ?? "";
    if (!level || !(DOCUMENT_LEVELS as readonly string[]).includes(level) || !UUID.test(entityId)) {
      return NextResponse.json({ error: "Say which record's documents to list." }, { status: 400 });
    }
    const allowed = await authorise(gate, level, entityId, "read");
    if (!allowed.ok) return allowed.response;
    return NextResponse.json(await listDocuments(gate.admin, { level, entityId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the documents");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (Number(req.headers.get("content-length") ?? 0) > AMC_DOCUMENT_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "The file is larger than 20 MB." }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const parsed = documentMetaSchema.safeParse({
    level: field("level"),
    entityId: field("entityId"),
    category: field("category"),
    title: field("title"),
    expiresOn: field("expiresOn"),
    notes: field("notes"),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const allowed = await authorise(gate, parsed.data.level, parsed.data.entityId, "write");
    if (!allowed.ok) return allowed.response;
    const document = await uploadDocument(
      gate.admin,
      { ...parsed.data, customerId: allowed.customerId },
      { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name || "document" },
      { id: gate.userId, label: gate.label },
    );
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not upload the document");
  }
}
