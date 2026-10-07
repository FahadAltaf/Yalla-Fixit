import { NextRequest, NextResponse } from "next/server";

import { UUID } from "@/lib/server/amc/business-schemas";
import { documentDownloadUrl, getDocument } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";

/** A 10-minute download link for one document, after the same access check as its record. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ documentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { documentId } = await ctx.params;
  if (!UUID.test(documentId)) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  try {
    const doc = await getDocument(gate.admin, documentId);
    if (doc.level === "contract") {
      const managed = await requireManagedContract(gate, doc.entityId, "read");
      if (!managed.ok) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ url: await documentDownloadUrl(gate.admin, doc) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not prepare the download");
  }
}
