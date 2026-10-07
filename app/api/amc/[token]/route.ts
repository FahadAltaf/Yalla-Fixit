import { after, NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimited } from "@/lib/server/request-origin";

import { recordAmcAudit } from "@/lib/server/amc/audit";
import { notifyProposalEvent } from "@/lib/server/amc/notifications";
import { archiveSignedContract } from "@/lib/server/amc/signed-archive";
import { readAmcSettings } from "@/lib/server/amc/settings";
import type { AmcSettings } from "@/components/dashboard/extensions/amc/amc-settings";
import { clientTransition } from "@/lib/amc/workflow";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  MAX_DECISION_BODY_BYTES,
  decisionSchema,
  publicSettingsFor,
  toPublicStatus,
} from "@/lib/server/amc/public-dto";
import { resolveLink, type LinkRow } from "@/lib/server/amc/link-resolution";
import { clientSignedOnLink, createContractFromApproval } from "@/lib/server/amc/contract-lifecycle";
import { readAmcConfig } from "@/lib/server/amc/config";

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
 * spreading the row (lib/server/amc/public-dto.ts).
 *
 * Token lifecycle: a link is usable only while its document waits for the
 * client (proposal_sent / contract_sent). Once answered, signed, moved on
 * to the contract, or reopened for changes, the same link is "closed": it
 * reports the outcome but carries no document and accepts no answer. A
 * link replaced by a newer send matches nothing (404); past its 30 days
 * it is refused (410).
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
  "proposal_sent_at",
  "contract_sent_at",
].join(", ");

type Row = LinkRow;

const NOT_FOUND = { error: "This link is not available" };

async function findByToken(token: string) {
  const admin = await createAdminServerClient();

  /*
    The lookup also reads the contract's own settings copy (FR6.4). If the
    database has not been migrated to have that column yet, it reads
    without it, and a contract shows the proposal's copy, which is what
    every contract used before. A client link must never fail over a
    column the page can do without. Read only, so the retry is safe.
    The hash is hex, so it is safe inside the filter string.
  */
  const lookup = async (hash: string): Promise<Row | null> => {
    const query = (columns: string) =>
      admin
        .from("amc_submissions")
        .select(columns)
        .or(`proposal_token_hash.eq.${hash},contract_token_hash.eq.${hash}`)
        .maybeSingle();
    const missing = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
    /* The payment plan and property type (Phase 4) first, then without them, then without the contract copy. */
    let { data, error } = await query(`${PUBLIC_SELECT}, contract_settings_snapshot, payment_plan, payment_plan_custom, property_type, client_answer`);
    if (missing(error)) ({ data, error } = await query(`${PUBLIC_SELECT}, contract_settings_snapshot`));
    if (missing(error)) ({ data, error } = await query(PUBLIC_SELECT));
    if (error) throw new Error(error.message);
    return (data as unknown as Row | null) ?? null;
  };

  /* lib/server/amc/link-resolution.ts: malformed, unknown and superseded
     tokens are a 404; an expired one a 410. */
  const resolved = await resolveLink(token, lookup);
  if (resolved.state === "not_found") {
    return { error: NextResponse.json(NOT_FOUND, { status: 404 }) };
  }
  if (resolved.state === "expired") {
    return {
      error: NextResponse.json(
        { error: "This link has expired. Please ask us to send it again." },
        { status: 410 },
      ),
    };
  }
  return { admin, row: resolved.row, kind: resolved.kind, open: resolved.state === "open" };
}

/**
 * FR5.5 / FR5.7 — what the client page needs to rebuild the full document
 * the team sent, with the same renderer. Only fields that print on the
 * document: the internal customer id stays behind, as do owner, status
 * history and the token columns.
 */
async function toPublicDocument(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  row: Row,
  kind: "proposal" | "contract",
) {
  const customer = { ...((row.customer ?? {}) as Record<string, unknown>) };
  delete customer.customerId;
  const services = (row.services ?? []) as Array<{ serviceId?: string; included?: boolean }>;
  const includedIds = services
    .filter((service) => service.included && typeof service.serviceId === "string")
    .map((service) => service.serviceId as string);
  /* FR6.4: the text this document was sent with. A contract has its own
     copy; contracts sent before it did went out with the proposal's. The
     live fallback only covers rows sent before snapshots existed. */
  const snapshot = ((kind === "contract" ? row.contract_settings_snapshot : null) ??
    row.settings_snapshot ??
    null) as Partial<AmcSettings> | null;
  /* Merged over the defaults, then trimmed (publicSettingsFor). Snapshots
     taken before 28 Sep 2026 -- every sent proposal in production on
     5 Oct 2026 -- have no clauseList or services of their own. */
  const settings = publicSettingsFor(
    snapshot,
    snapshot ? null : await readAmcSettings(admin),
    includedIds,
  );
  return {
    source: {
      property: row.property ?? {},
      customer: { ...customer, proposalNumber: row.proposal_number ?? "" },
      document_options: row.document_options ?? {},
      services,
      discount_percent: Number(row.discount_percent ?? 0),
    },
    documentType: kind,
    /* Only what this document prints: no approver emails, no disabled
       clauses, no other services' scopes. */
    settings,
    sentAt:
      (kind === "contract" ? row.contract_sent_at : row.proposal_sent_at) ?? null,
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  /* Per-address throttle against link guessing (lib/server/request-origin.ts). */
  if (rateLimited(`amc-link:get:${clientAddress(req.headers)}`, 120, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }
  try {
    const { token } = await ctx.params;
    const found = await findByToken(token);
    if (found.error) return found.error;

    return NextResponse.json(
      {
        data: toPublicStatus(found.row, found.kind),
        /* A closed link shows the outcome only, never the document. */
        document: found.open
          ? await toPublicDocument(found.admin, found.row, found.kind)
          : null,
      },
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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  if (rateLimited(`amc-link:post:${clientAddress(req.headers)}`, 20, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }
  try {
    const { token } = await ctx.params;
    const found = await findByToken(token);
    if (found.error) return found.error;
    const { admin, row, kind } = found;

    /* Bounded before parsing: an answer is a name and a short reason. */
    const raw = await req.text().catch(() => "");
    if (raw.length > MAX_DECISION_BODY_BYTES) {
      return NextResponse.json({ error: "Your answer is too long" }, { status: 413 });
    }
    let json: unknown = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const parsed = decisionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const now = new Date().toISOString();

    /*
      FR5.5 — "the answer and the time are recorded", once. The rule is
      lib/amc/workflow.ts (clientTransition); the expected status is also
      re-asserted on the update, so a client who leaves the page open and
      clicks twice, or forwards the link to a colleague who also answers,
      cannot overwrite the first answer.
    */
    const check = clientTransition(body.action, kind, row.status);
    const expected = kind === "contract" ? "contract_sent" : "proposal_sent";
    if (!check.ok && check.status === 400) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    if (!check.ok) {
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
              client_rejected_reason: body.action === "request_revision" ? `Revision requested: ${body.reason}` : body.reason,
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

    /* Phase 5: which answer, from the link (best effort before 20261007150000). */
    if (body.action !== "sign") {
      const { error: answerError } = await admin
        .from("amc_submissions")
        .update({
          client_answer: body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "revision_requested",
          client_answer_source: "link",
          client_answer_recorded_by: null,
          client_answer_evidence_id: null,
        })
        .eq("id", row.id);
      if (answerError && answerError.code !== "42703" && answerError.code !== "PGRST204") console.error("AMC client answer not recorded:", answerError.message);
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
            : body.action === "request_revision"
              ? "revision_requested_by_client"
              : "proposal_rejected_by_client",
      actorId: null,
      actorLabel: body.name,
      origin: "client",
      justification: body.action === "reject" || body.action === "request_revision" ? body.reason : null,
      payload: { from: expected, to: update.status },
    });

    /*
      After the client has their answer: tell the team, and for a
      signature archive the contract exactly as signed. Both run once,
      because only the request whose conditional update matched gets here
      (a retry is answered 409 above), and both are idempotent anyway.
    */
    const submissionId = row.id;
    after(async () => {
      /* Phase 6: the contract exists from the client's approval; a signature on the link is recorded on it. */
      if (body.action === "approve") {
        await createContractFromApproval(admin, submissionId, { id: null, label: body.name }, await readAmcConfig(admin));
      }
      if (body.action === "sign") {
        await clientSignedOnLink(admin, submissionId, body.name, now);
      }
      if (body.action === "sign") {
        try {
          await archiveSignedContract(admin, submissionId, { when: "at_signing", actor: null });
        } catch (archiveError) {
          console.error(
            "AMC signed contract not archived (staff can archive it from the contract page):",
            archiveError instanceof Error ? archiveError.message : archiveError,
          );
        }
      }
      await notifyProposalEvent(admin, {
        event: body.action === "sign" ? "contract_signed" : body.action === "approve" ? "client_approved" : "client_rejected",
        submissionId,
        actor: null,
        at: now,
        facts: {
          signedByName: body.name,
          signedAt: body.action === "sign" ? now : null,
          reason: body.action === "reject" ? body.reason : body.action === "request_revision" ? `Revision requested: ${body.reason}` : null,
        },
      });
    });

    return NextResponse.json(
      { data: toPublicStatus(data as unknown as Row, kind) },
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
