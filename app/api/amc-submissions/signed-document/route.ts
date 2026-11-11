import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { canOperateContract, canReadContract } from "@/lib/amc/access";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID } from "@/lib/server/amc/business-schemas";
import {
  ArchiveError,
  archiveSignedContract,
  signedArchiveFor,
  signedArchiveUrl,
} from "@/lib/server/amc/signed-archive";

/**
 * The archived signed contract of a proposal.
 *
 * GET ?id=<proposal>            its archive record, or null
 * GET ?id=<proposal>&open=1     also a link to the file, valid five minutes
 * POST { id }                   archives it now if it was not archived at
 *                               signing (marked "archived after signing")
 *
 * Read: whoever may read the contract (owner, approvers, AMC Operations);
 * archive now: whoever may operate it. Anyone else gets "not found". The file is
 * never public: the link is minted per request after this check.
 */

async function ownerOf(admin: SupabaseClient, id: string) {
  const { data } = await admin.from("amc_submissions").select("id, owner_id, status").eq("id", id).maybeSingle();
  return data as { id: string; owner_id: string | null; status: string } | null;
}

function archiveErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ArchiveError) return NextResponse.json({ error: error.message }, { status: error.status });
  return contractErrorResponse(error, fallback);
}

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const submission = await ownerOf(gate.admin, id);
    if (!submission || !canReadContract(gate.actor, submission.owner_id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const archive = await signedArchiveFor(gate.admin, id);
    const url = archive && req.nextUrl.searchParams.get("open") === "1" ? await signedArchiveUrl(gate.admin, archive) : null;
    return NextResponse.json(
      { archive, url, signed: submission.status === "signed" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return archiveErrorResponse(error, "Could not load the signed contract");
  }
}

const postSchema = z.object({ id: z.string().regex(UUID) });

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const submission = await ownerOf(gate.admin, parsed.data.id);
    if (!submission || !canOperateContract(gate.actor, submission.owner_id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const archive = await archiveSignedContract(gate.admin, parsed.data.id, {
      when: "after_signing",
      actor: { id: gate.userId, label: gate.label },
    });
    return NextResponse.json({ archive });
  } catch (error) {
    return archiveErrorResponse(error, "Could not archive the signed contract");
  }
}
