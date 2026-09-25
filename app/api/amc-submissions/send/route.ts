import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordAmcAudit } from "@/lib/server/amc/audit";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { linkTokenExpiry, mintLinkToken } from "@/lib/server/link-token";
import { sendEmail } from "@/lib/server/send-email";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/**
 * Sending a document to the client (FR5.4, FR5.6).
 *
 *   proposal   approved           ->  proposal_sent
 *   contract   proposal_approved  ->  contract_sent
 *
 * The status gate is the whole of FR5.1: a proposal that has not been
 * approved internally cannot be sent, and a contract cannot be sent before
 * the client has approved the proposal. Neither is a UI convention — both
 * are checked here.
 *
 * `deliver: "link"` mints the token and returns the URL without sending
 * anything, which is FR5.4's "copy the link to send over WhatsApp".
 */

const sendSchema = z.object({
  id: z.string().uuid(),
  document: z.enum(["proposal", "contract"]),
  deliver: z.enum(["email", "link"]).default("email"),
  /* The address confirmed in the send dialog. Falls back to the
     customer email saved on the proposal. */
  to: z.string().trim().email().optional(),
  /* The document as a PDF, built in the browser like the snagging
     quotation, attached to the email. */
  pdf_base64: z.string().optional(),
  pdf_filename: z.string().max(200).optional(),
});

/** Which status a document may be sent from, and what it becomes. */
const TRANSITIONS = {
  proposal: { from: "approved", to: "proposal_sent" },
  contract: { from: "proposal_approved", to: "contract_sent" },
} as const;

const SELECT =
  "id, owner_id, status, customer, property, proposal_number, final_price, settings_snapshot, contract_settings_snapshot";

/* A column this route reads or writes is not in the database: a
   deployment gap the user cannot fix, so name the migrations instead of
   echoing the raw error. */
function missingMigration(detail: string) {
  console.error("AMC send: a column is missing:", detail);
  return NextResponse.json(
    {
      error:
        "Sending to clients isn't set up on this database yet. An administrator needs to apply the latest AMC migrations (20260916110000_amc_client_links.sql and 20260922130000_amc_contract_settings_snapshot.sql).",
    },
    { status: 503 },
  );
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "").replace(
    /\/$/,
    "",
  );
}

function formatAed(value: number): string {
  return `AED ${value.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* The client email, in the same layout as the snagging emails. */
function amcEmailHtml(o: {
  document: "proposal" | "contract";
  customerName: string;
  proposalNumber: string;
  property: string;
  finalPrice: number;
  link: string;
  expiresAt: string;
}): string {
  const isProposal = o.document === "proposal";
  const expires = new Date(o.expiresAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return clientEmailHtml({
    eyebrow: isProposal ? "AMC proposal" : "AMC contract",
    heading: isProposal
      ? "Your maintenance proposal is ready"
      : "Your maintenance contract is ready to sign",
    greeting: `Dear ${o.customerName.trim() || "customer"},`,
    paragraphs: isProposal
      ? [
          `Thank you for considering Yalla Fix It. Your annual maintenance contract proposal${o.property ? ` for <strong>${escapeEmailHtml(o.property)}</strong>` : ""} is ready.`,
          "Please review it and approve it, or tell us what you would like changed.",
        ]
      : [
          "Thank you for approving the proposal.",
          `Your annual maintenance contract${o.property ? ` for <strong>${escapeEmailHtml(o.property)}</strong>` : ""} is ready. Please review it and sign it online.`,
        ],
    details: [
      ...(o.proposalNumber
        ? [{ label: "Reference", value: o.proposalNumber }]
        : []),
      ...(o.property ? [{ label: "Property", value: o.property }] : []),
      { label: "Annual fee (excl. VAT)", value: formatAed(o.finalPrice) },
    ],
    cta: {
      label: isProposal ? "Review the proposal" : "Review and sign",
      url: o.link,
    },
    footnote: `This link is personal to you and works until ${expires}. Please don't share it. The ${isProposal ? "proposal" : "contract"} is also attached as a PDF.`,
  });
}

export async function POST(req: NextRequest) {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUseAmc(access.accessUser)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = sendSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { profile } = access;
  const {
    id,
    document,
    deliver,
    to: confirmedTo,
    pdf_base64: pdfBase64,
    pdf_filename: pdfFilename,
  } = parsed.data;
  const transition = TRANSITIONS[document];
  const admin = await createAdminServerClient();

  const { data: existing, error: fetchError } = await admin
    .from("amc_submissions")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    if (fetchError.code === "42703" || fetchError.code === "PGRST204")
      return missingMigration(fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  /*
    Sending is the owner's, and only the owner's.

    An approver decides whether a proposal MAY go out; they do not send
    it. It used to allow either, so an approver who opened somebody
    else's approved proposal was shown Send and could email a client
    about work that is not theirs -- under the owner's name, since the
    document carries the owner's account manager and contacts.
  */
  if (existing.owner_id !== profile.id) {
    return NextResponse.json(
      {
        error:
          "Only the person who raised this proposal can send it to the client.",
      },
      { status: 403 },
    );
  }
  /* A document already sent can be sent again (a new email, or a fresh
     link to share). The status stays where it is. */
  const isResend = existing.status === transition.to;
  if (existing.status !== transition.from && !isResend) {
    return NextResponse.json(
      {
        error:
          document === "proposal"
            ? "This proposal has not been approved internally yet."
            : "The client has not approved the proposal yet.",
      },
      { status: 409 },
    );
  }

  /*
    FR4.4 — "no document ever prints XXX". The TPH contact numbers and
    coordination emails live in AMC Settings and ship as XXX until an admin
    enters them, so without this check the first proposal sent would carry
    them straight to the client.

    Checked BEFORE the snapshot below, never after: a document keeps its
    snapshot for ever (FR6.4), so a placeholder frozen into one could never
    be corrected.

    Which settings a send uses: the proposal keeps the copy taken when it
    was first sent, so a re-send matches what the client already has. The
    contract takes the settings as they are now, so a clause edited after
    the proposal went out does reach the contract.
  */
  const effectiveSettings =
    document === "proposal"
      ? (existing.settings_snapshot ?? (await readAmcSettings(admin)))
      : isResend && existing.contract_settings_snapshot
        ? /* A re-sent contract matches the one the client already has. */
          existing.contract_settings_snapshot
        : await readAmcSettings(admin);
  if (/XXX/.test(JSON.stringify(effectiveSettings))) {
    return NextResponse.json(
      {
        error:
          "AMC Settings still has placeholder values (XXX), usually the TPH contact numbers or coordination emails. An admin needs to fill them in under Extensions > AMC Settings before anything can be sent to a client.",
      },
      { status: 409 },
    );
  }

  const token = mintLinkToken();
  const expiresAt = linkTokenExpiry();
  const now = new Date().toISOString();
  const prefix = document === "proposal" ? "proposal" : "contract";

  const { data, error } = await admin
    .from("amc_submissions")
    .update({
      status: transition.to,
      [`${prefix}_token_hash`]: token.hash,
      [`${prefix}_token_hint`]: token.hint,
      [`${prefix}_token_expires_at`]: expiresAt,
      [`${prefix}_sent_at`]: now,
      /*
        FR6.4: freeze the text the document is sent with, in this same
        write so a failed send freezes nothing. The proposal's copy is
        taken once and never replaced; the contract gets its own, which
        leaves the proposal the client already holds unchanged.
      */
      ...(document === "contract"
        ? isResend && existing.contract_settings_snapshot
          ? {}
          : { contract_settings_snapshot: effectiveSettings }
        : existing.settings_snapshot
          ? {}
          : { settings_snapshot: effectiveSettings }),
      updated_at: now,
    })
    .eq("id", id)
    /* Re-asserted, so two tabs sending at once cannot both mint a token
       and leave the second one's link as the only working copy. */
    .eq("status", existing.status)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST204" || error.code === "42703")
      return missingMigration(error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      {
        error:
          "Someone else updated this proposal a moment ago. Reload and try again.",
      },
      { status: 409 },
    );
  }

  const customer = (existing.customer ?? {}) as {
    customerName?: string;
    customerEmail?: string;
  };
  const link = `${appUrl()}/amc/${token.raw}`;

  let emailed = false;
  if (deliver === "email") {
    const to = confirmedTo || customer.customerEmail?.trim();
    if (!to) {
      /*
        The status change and the token are already committed, so this is
        reported rather than rolled back: the link is valid and the team
        can copy it. Failing the whole request would leave a sent document
        the system thinks was never sent.
      */
      return NextResponse.json(
        {
          submission: data,
          link,
          emailed: false,
          warning:
            "No customer email on this proposal — the link was created but nothing was sent. Copy the link instead.",
        },
        { status: 200 },
      );
    }

    try {
      await sendEmail({
        to,
        subject:
          document === "proposal"
            ? `Your AMC proposal ${existing.proposal_number ?? ""}`.trim()
            : `Your AMC contract ${existing.proposal_number ?? ""}`.trim(),
        html: amcEmailHtml({
          document,
          customerName: customer.customerName ?? "",
          proposalNumber: existing.proposal_number ?? "",
          property:
            (existing.property as { propertyAddress?: string } | null)
              ?.propertyAddress ?? "",
          finalPrice: Number(existing.final_price ?? 0),
          link,
          expiresAt,
        }),
        attachment: pdfBase64
          ? {
              filename:
                pdfFilename?.replace(/[^\w.\- ]+/g, "_") ||
                `${document === "proposal" ? "Proposal" : "Contract"}-${existing.proposal_number ?? "AMC"}.pdf`,
              content: pdfBase64,
              contentType: "application/pdf",
            }
          : undefined,
      });
      emailed = true;
    } catch (mailError) {
      console.error("AMC send email failed:", mailError);
      return NextResponse.json({
        submission: data,
        link,
        emailed: false,
        warning:
          "The document was marked as sent and the link is valid, but the email could not be delivered. Copy the link and send it another way.",
      });
    }
  }

  /* FR5.9 — the raw token is never audited; the hint identifies the link
     without being usable. */
  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: id,
    eventType: document === "proposal" ? "proposal_sent" : "contract_sent",
    actorId: profile.id,
    actorLabel: profile.full_name ?? profile.email ?? null,
    payload: {
      document,
      deliver,
      emailed,
      tokenHint: token.hint,
      expiresAt,
      resend: isResend,
      to:
        deliver === "email"
          ? confirmedTo || customer.customerEmail || null
          : null,
    },
  });

  return NextResponse.json({ submission: data, link, emailed });
}
