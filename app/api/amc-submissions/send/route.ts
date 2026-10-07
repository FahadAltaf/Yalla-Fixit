import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordAmcAudit } from "@/lib/server/amc/audit";
import { notifyProposalEvent } from "@/lib/server/amc/notifications";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { readAmcConfig } from "@/lib/server/amc/config";
import { proposalValidUntil } from "@/lib/amc/proposal-rules";
import { proposalShareTexts, recordSend, whatsappMessages } from "@/lib/server/amc/proposal-share";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { linkTokenExpiry, mintLinkToken } from "@/lib/server/link-token";
import { sendEmail } from "@/lib/server/send-email";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import {
  describePlaceholders,
  findPlaceholders,
  printedAmcText,
} from "@/lib/amc/placeholders";
import { MAX_ATTACHMENT_BYTES, looksLikePdf } from "@/lib/server/email-request-policy";
import { STALE_CLIENT_DECISION_FIELDS, SEND_TO, canSend } from "@/lib/amc/workflow";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { toFils } from "@/lib/amc/pricing";
import {
  getAmcSettingsDefaults,
  mergeAmcSettings,
} from "@/components/dashboard/extensions/amc/amc-settings";

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
 *
 * Every attempt is audited, including ones refused before anything changes
 * (placeholders, a bad attachment) and ones where the email then fails, so
 * a send that did not reach the client can still be traced.
 *
 * Phase 5 (BRD 5.6, 6.1): a proposal is shared by email (Email 1 from the
 * templates in AMC configuration, to one or more contacts, the owner in
 * copy) or by WhatsApp (the message is prepared with the link for the
 * owner to send from WhatsApp), and every send is logged with its channel,
 * recipients, version, user and time.
 *
 * The PDF attached to the email is still built in the browser. The server
 * checks it is a PDF of sane size and names it itself, but cannot prove
 * its pages match the approved data; generating it on the server belongs
 * to the Signed Contract Archive phase (see the hardening report).
 */

const sendSchema = z.object({
  id: z.string().uuid(),
  document: z.enum(["proposal", "contract"]),
  deliver: z.enum(["email", "link", "whatsapp"]).default("email"),
  /* Phase 5: the contacts it goes to (emails, or phone numbers for WhatsApp). */
  recipients: z
    .array(z.object({ name: z.string().trim().max(200).default(""), address: z.string().trim().min(3).max(200) }).strict())
    .max(10)
    .optional(),
  /* Email 1 copies the coordinator (the proposal's owner). */
  cc_owner: z.boolean().default(true),
  /* The address confirmed in the send dialog. Falls back to the
     customer email saved on the proposal. */
  to: z.string().trim().email().optional(),
  /* The document as a PDF, built in the browser like the snagging
     quotation, attached to the email. */
  pdf_base64: z
    .string()
    .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4, "The PDF is too large to email")
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "The attachment is not valid base64")
    .optional(),
  /* Accepted for compatibility; the server names the file itself. */
  pdf_filename: z.string().max(200).optional(),
});

const SELECT =
  "id, owner_id, status, customer, property, proposal_number, final_price, discount_percent, services, document_options, settings_snapshot, contract_settings_snapshot";

/* What a failed or refused attempt records: never the request, the token
   or the provider's full response. */
function safeSummary(message: unknown): string {
  const text = message instanceof Error ? message.message : String(message ?? "");
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/re_[A-Za-z0-9_]+/g, "<key>")
    .slice(0, 200);
}

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
    recipients: chosen,
    cc_owner: ccOwner,
  } = parsed.data;
  const admin = await createAdminServerClient();
  const actorLabel = profile.full_name ?? profile.email ?? null;
  /* An attempt that stops before the status changes, recorded so the
     trail shows it was tried and why it did not go. */
  const auditRefusal = (reason: string, detail?: Record<string, unknown>) =>
    recordAmcAudit(admin, {
      entityType: "submission",
      entityId: id,
      eventType: `${document}_send_refused`,
      actorId: profile.id,
      actorLabel,
      justification: reason,
      payload: { document, deliver, outcome: "refused", ...detail },
    });

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
  const sentStatus = SEND_TO[document];
  const isResend = existing.status === sentStatus;
  if (!canSend(document, existing.status)) {
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
  /*
    The stored fee is what the email, the list and the client page quote;
    the document recomputes it from the rows against these settings. They
    must agree, so a service switched off in Settings after approval stops
    the send instead of producing a PDF with a lower total.
  */
  const mergedSettings = mergeAmcSettings(
    getAmcSettingsDefaults(),
    effectiveSettings as Parameters<typeof mergeAmcSettings>[1],
  );
  const repriced = priceSubmission({
    services: (existing.services ?? []) as Parameters<typeof priceSubmission>[0]["services"],
    discountPercent: Number(existing.discount_percent ?? 0),
    unitType: String((existing.property as { unitType?: string } | null)?.unitType ?? ""),
    settings: mergedSettings,
  });
  /* One fil of slack: proposals priced by the old code could round a
     half-fil discount the other way. New proposals match exactly. */
  if (
    !repriced.ok ||
    Math.abs(toFils(repriced.final_price) - toFils(Number(existing.final_price ?? 0))) > 1
  ) {
    await auditRefusal("price no longer matches the settings in force", {
      reason: repriced.ok ? "final price differs" : repriced.error,
    });
    return NextResponse.json(
      {
        error: repriced.ok
          ? "The proposal's price no longer matches its services. Open it, save it again and resubmit it for approval."
          : `${repriced.error} The proposal has to be revised and approved again before it can be sent.`,
      },
      { status: 409 },
    );
  }

  /* Only text this document will print, from the settings it will use
     and the proposal's own fields (lib/amc/placeholders.ts). */
  const placeholders = findPlaceholders(
    printedAmcText(
      mergedSettings,
      existing as Parameters<typeof printedAmcText>[1],
      document,
    ),
  );
  if (placeholders.length > 0) {
    await auditRefusal("placeholder text", {
      locations: placeholders.map((hit) => hit.location).slice(0, 10),
    });
    return NextResponse.json(
      {
        error: `This ${document} still contains placeholder text (XXX), so it can't be sent yet. Fix: ${describePlaceholders(
          placeholders,
        )}. AMC Settings is under Settings > AMC.`,
        placeholders,
      },
      { status: 409 },
    );
  }

  /* The attachment is checked before anything changes, so a bad file
     never leaves a document marked as sent. */
  if (deliver === "email" && pdfBase64) {
    if (!looksLikePdf(pdfBase64)) {
      await auditRefusal("attachment is not a PDF");
      return NextResponse.json({ error: "The attachment is not a PDF." }, { status: 400 });
    }
    if (Buffer.byteLength(pdfBase64, "base64") > MAX_ATTACHMENT_BYTES) {
      await auditRefusal("attachment too large");
      return NextResponse.json({ error: "The PDF is too large to email." }, { status: 400 });
    }
  }

  const token = mintLinkToken();
  const expiresAt = linkTokenExpiry();
  const now = new Date().toISOString();
  const prefix = document === "proposal" ? "proposal" : "contract";

  const { data, error } = await admin
    .from("amc_submissions")
    .update({
      status: sentStatus,
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
      /* A proposal sent (or re-sent) is waiting for a fresh answer; an
         answer to an earlier version must not still show against it. */
      ...(document === "proposal" ? STALE_CLIENT_DECISION_FIELDS : {}),
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

  /*
    Valid for the configured days from this send (DEV-366). A separate,
    best-effort write: on a database without 20261007140000 the send above
    must still succeed.
  */
  if (document === "proposal") {
    try {
      const config = await readAmcConfig(admin);
      await admin.from("amc_submissions").update({ valid_until: proposalValidUntil(now, config.proposals.validityDays) }).eq("id", id);
    } catch (validityError) {
      console.warn("[amc:send] validity date not set:", validityError instanceof Error ? validityError.message : validityError);
    }
  }

  /* Recorded for the owner when someone else sent it (only the owner can
     today, so this writes nothing yet). No client link in it. */
  await notifyProposalEvent(admin, {
    event: document === "proposal" ? "proposal_sent" : "contract_sent",
    submissionId: id,
    actor: { id: profile.id, label: actorLabel },
    at: now,
  });

  const customer = (existing.customer ?? {}) as {
    customerName?: string;
    customerEmail?: string;
  };
  const link = `${appUrl()}/amc/${token.raw}`;

  const auditSent = (outcome: string, extra: Record<string, unknown> = {}) =>
    recordAmcAudit(admin, {
      entityType: "submission",
      entityId: id,
      eventType: document === "proposal" ? "proposal_sent" : "contract_sent",
      actorId: profile.id,
      actorLabel,
      payload: {
        document,
        deliver,
        outcome,
        tokenHint: token.hint,
        expiresAt,
        resend: isResend,
        ...extra,
      },
    });

  /* Phase 4/5 fields, read apart so a database without them still sends. */
  const { data: extra } = await admin
    .from("amc_submissions")
    .select("current_version, payment_plan, payment_plan_custom, renewal_of_contract_id, valid_until")
    .eq("id", id)
    .maybeSingle<Record<string, unknown>>();
  const versionNo = Number(extra?.current_version ?? 1);
  const shareRow = { ...(existing as Record<string, unknown>), ...(extra ?? {}) };
  const ownerName = profile.full_name?.trim() || profile.email || "Yalla Fix It";
  const ownerPhone = ((profile as { phone?: string | null }).phone ?? null) || null;
  const texts =
    document === "proposal"
      ? await proposalShareTexts(admin, shareRow, {
          settings: mergedSettings,
          config: await readAmcConfig(admin),
          link,
          validUntil: (extra?.valid_until as string | null) ?? null,
          versionNo,
          owner: { name: ownerName, phone: ownerPhone },
        }).catch((textError) => {
          console.error("[amc:send] share texts not built:", textError instanceof Error ? textError.message : textError);
          return null;
        })
      : null;
  const log = (channel: "email" | "whatsapp" | "link", recipients: Array<{ name: string; address: string }>, outcome: Parameters<typeof recordSend>[1]["outcome"], extraLog: { cc?: string[]; detail?: string | null } = {}) =>
    recordSend(admin, { submissionId: id, versionNo, document, channel, recipients, outcome, tokenHint: token.hint, sentBy: profile.id, ...extraLog });

  /* WhatsApp: the message is prepared with the link; the owner sends it from WhatsApp (BRD 5.6). */
  if (deliver === "whatsapp") {
    const people = chosen ?? [];
    const text = texts?.message ?? `Your Yalla Fix It AMC ${document} is ready: ${link}`;
    const messages = whatsappMessages(people, text);
    await log("whatsapp", people, "prepared");
    await auditSent("whatsapp_prepared", { recipients: people.length });
    return NextResponse.json({ submission: data, link, emailed: false, messages, message: text });
  }

  let emailed = false;
  if (deliver === "email") {
    const fallback = confirmedTo || customer.customerEmail?.trim();
    const people = chosen?.length ? chosen : fallback ? [{ name: customer.customerName ?? "", address: fallback }] : [];
    const to = people.map((p) => p.address);
    const cc = ccOwner && profile.email && !to.includes(profile.email) ? [profile.email] : [];
    if (to.length === 0) {
      await auditSent("no_recipient", { emailed: false, to: null });
      await log("email", [], "no_recipient");
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
      const blocks = texts ? texts.body.split(/\n{2,}/) : [];
      await sendEmail({
        to,
        ...(cc.length ? { cc } : {}),
        subject: texts
          ? texts.subject
          : document === "proposal"
            ? `Your AMC proposal ${existing.proposal_number ?? ""}`.trim()
            : `Your AMC contract ${existing.proposal_number ?? ""}`.trim(),
        html: texts
          ? /* Email 1, as AMC configuration words it (BRD 6.1). */
            clientEmailHtml({
              eyebrow: "AMC proposal",
              heading: `Proposal ${existing.proposal_number ?? ""} V${versionNo}`.trim(),
              greeting: escapeEmailHtml(blocks[0] ?? ""),
              paragraphs: blocks.slice(1).map((b) => escapeEmailHtml(b).replace(/\n/g, "<br>")),
              details: [],
              cta: { label: "Review the proposal", url: link },
              footnote: `This link is personal to you and works until ${new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. The proposal is also attached as a PDF.`,
            })
          : amcEmailHtml({
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
              /* Named here, never taken from the request. */
              filename: `${document === "proposal" ? "Proposal" : "Contract"}-${String(
                existing.proposal_number ?? "AMC",
              ).replace(/[^\w-]+/g, "_")}${document === "proposal" ? `-V${versionNo}` : ""}.pdf`,
              content: pdfBase64,
              contentType: "application/pdf",
            }
          : undefined,
      });
      emailed = true;
      await log("email", people, "sent", { cc });
    } catch (mailError) {
      console.error("AMC send email failed:", safeSummary(mailError));
      await auditSent("email_failed", {
        emailed: false,
        to: to.join(", "),
        error: safeSummary(mailError),
      });
      await log("email", people, "failed", { cc, detail: safeSummary(mailError) });
      return NextResponse.json({
        submission: data,
        link,
        emailed: false,
        warning:
          "The document was marked as sent and the link is valid, but the email could not be delivered. Copy the link and send it another way.",
      });
    }
    /* FR5.9 — the raw token is never audited; the hint identifies the link
       without being usable. */
    await auditSent("emailed", { emailed, to: to.join(", "), cc: cc.join(", ") || null, recipients: to.length });
    return NextResponse.json({ submission: data, link, emailed });
  }

  await auditSent("link_created", { emailed: false, to: null });
  await log("link", chosen ?? [], "link_created");
  return NextResponse.json({ submission: data, link, emailed });
}
