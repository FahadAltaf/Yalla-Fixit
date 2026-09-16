import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordAmcAudit } from "@/lib/server/amc/audit";
import { hashLinkToken } from "@/lib/server/link-token";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * The client's page (FR5.5, FR5.7, NFR4).
 *
 * No login: whoever holds the token is the client. The browser never
 * touches the table — this route looks the submission up by token hash
 * with the service-role client, which is what lets "no account" stop short
 * of "public table".
 *
 * GET returns only what the page has to render. The submission row carries
 * the owner's id, internal audit trail, both token hashes and the
 * approver's send-back reasons; none of that is any of the client's
 * business, so the response is assembled field by field rather than
 * spreading the row.
 */

const PUBLIC_SELECT = [
  "id",
  "status",
  "proposal_number",
  "customer",
  "property",
  "services",
  "document_options",
  "settings_snapshot",
  "discount_percent",
  "discount_amount",
  "final_price",
  "proposal_token_hash",
  "proposal_token_expires_at",
  "contract_token_hash",
  "contract_token_expires_at",
  "client_decision",
  "client_decided_at",
  "signed_by_name",
  "signed_at",
].join(", ");

type Row = Record<string, unknown> & {
  id: string;
  status: string;
  proposal_token_hash: string | null;
  contract_token_hash: string | null;
  proposal_token_expires_at: string | null;
  contract_token_expires_at: string | null;
};

const NOT_FOUND = { error: "This link is not available" };

async function findByToken(token: string) {
  /* A short token is never one of ours — 32 random bytes base64url is 43
     characters — so this is rejected before it reaches the database. */
  if (!token || token.length < 32) {
    return { error: NextResponse.json(NOT_FOUND, { status: 404 }) };
  }

  const admin = await createAdminServerClient();
  const hash = hashLinkToken(token);

  const { data, error } = await admin
    .from("amc_submissions")
    .select(PUBLIC_SELECT)
    .or(`proposal_token_hash.eq.${hash},contract_token_hash.eq.${hash}`)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { error: NextResponse.json(NOT_FOUND, { status: 404 }) };

  const row = data as unknown as Row;
  /* Which document this link is for is decided by which hash matched, not
     by anything the caller sends. */
  const kind: "proposal" | "contract" =
    row.contract_token_hash === hash ? "contract" : "proposal";

  const expiresAt =
    kind === "contract"
      ? row.contract_token_expires_at
      : row.proposal_token_expires_at;

  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return {
      error: NextResponse.json(
        { error: "This link has expired. Please ask us to send it again." },
        { status: 410 },
      ),
    };
  }

  return { admin, row, kind };
}

/** Never send the client the internal fields. */
function toPublicPayload(row: Row, kind: "proposal" | "contract") {
  const customer = (row.customer ?? {}) as Record<string, unknown>;
  return {
    kind,
    status: row.status,
    proposalNumber: row.proposal_number ?? null,
    customerName: customer.customerName ?? null,
    startDate: customer.startDate ?? null,
    endDate: customer.endDate ?? null,
    paymentTerms: customer.paymentTerms ?? null,
    property: row.property ?? null,
    services: row.services ?? [],
    documentOptions: row.document_options ?? {},
    discountPercent: Number(row.discount_percent ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    finalPrice: Number(row.final_price ?? 0),
    clientDecision: row.client_decision ?? null,
    clientDecidedAt: row.client_decided_at ?? null,
    signedByName: row.signed_by_name ?? null,
    signedAt: row.signed_at ?? null,
  };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const found = await findByToken(token);
    if (found.error) return found.error;

    return NextResponse.json(
      { data: toPublicPayload(found.row, found.kind) },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch (error) {
    console.error("Public AMC GET error:", error);
    return NextResponse.json(
      { error: "Failed to load this document" },
      { status: 500 },
    );
  }
}

const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    name: z.string().trim().min(1, "Please enter your name"),
  }),
  z.object({
    action: z.literal("reject"),
    name: z.string().trim().min(1, "Please enter your name"),
    reason: z.string().trim().min(1, "Please tell us what needs changing"),
  }),
  z.object({
    action: z.literal("sign"),
    name: z.string().trim().min(1, "Please type your full name to sign"),
  }),
]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const found = await findByToken(token);
    if (found.error) return found.error;
    const { admin, row, kind } = found;

    const parsed = decisionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const now = new Date().toISOString();

    const isSigning = body.action === "sign";
    if (isSigning !== (kind === "contract")) {
      return NextResponse.json(
        { error: "That action does not apply to this link" },
        { status: 400 },
      );
    }

    /*
      FR5.5 — "the answer and the time are recorded", once. The expected
      status is re-asserted on the update, so a client who leaves the page
      open and clicks twice, or forwards the link to a colleague who also
      answers, cannot overwrite the first answer.
    */
    const expected = kind === "contract" ? "contract_sent" : "proposal_sent";
    if (row.status !== expected) {
      return NextResponse.json(
        {
          error:
            row.status === "proposal_approved" || row.status === "signed"
              ? "Thank you — we have already recorded your answer."
              : "This document is no longer awaiting your answer.",
        },
        { status: 409 },
      );
    }

    const update: Record<string, unknown> =
      body.action === "sign"
        ? {
            status: "signed",
            signed_by_name: body.name,
            signed_at: now,
          }
        : body.action === "approve"
          ? {
              status: "proposal_approved",
              client_decision: "approved",
              client_decided_at: now,
              client_decided_by_name: body.name,
            }
          : {
              status: "proposal_rejected",
              client_decision: "rejected",
              client_decided_at: now,
              client_decided_by_name: body.name,
              client_rejected_reason: body.reason,
            };

    const { data, error } = await admin
      .from("amc_submissions")
      .update({ ...update, updated_at: now })
      .eq("id", row.id)
      .eq("status", expected)
      .select(PUBLIC_SELECT)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json(
        { error: "Thank you — we have already recorded your answer." },
        { status: 409 },
      );
    }

    /* FR5.9 — origin 'client', because there is no account behind this. */
    await recordAmcAudit(admin, {
      entityType: "submission",
      entityId: row.id,
      eventType:
        body.action === "sign"
          ? "contract_signed"
          : body.action === "approve"
            ? "proposal_approved_by_client"
            : "proposal_rejected_by_client",
      actorId: null,
      actorLabel: body.name,
      origin: "client",
      justification: body.action === "reject" ? body.reason : null,
      payload: { from: expected, to: update.status },
    });

    return NextResponse.json(
      { data: toPublicPayload(data as unknown as Row, kind) },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch (error) {
    console.error("Public AMC POST error:", error);
    return NextResponse.json(
      { error: "Failed to record your answer" },
      { status: 500 },
    );
  }
}
