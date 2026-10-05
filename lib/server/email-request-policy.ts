import { z } from "zod";

/**
 * What /api/send-email accepts, and from whom.
 *
 * Kept apart from the route so the rules can be tested without a server.
 *
 * Callers, as of 5 Oct 2026 (see docs/amc-proposals-v2-hardening-report.md):
 *   trusted   - server code through emailService (signed internal call):
 *               snagging escalations / deliver / reject, todos and todo
 *               reminders, auth invite and password reset;
 *             - signed-in portal users: the quotation preview modal, which
 *               emails a customer a PDF quotation.
 *   anonymous - the public quotation review page (app/quotations/review),
 *               which tells the quotation's owner that the customer
 *               accepted or rejected it. The owner is a member of staff.
 *
 * So an anonymous request may only reach the company's own mailboxes, one
 * at a time, without copies or attachments. That keeps the public page
 * working while the endpoint stops being a relay to the rest of the world.
 */

export const MAX_BODY_BYTES = 15 * 1024 * 1024;
export const MAX_HTML_CHARS = 500_000;
export const MAX_SUBJECT_CHARS = 300;
export const MAX_RECIPIENTS = 50;
/** Decoded attachment size. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const email = z
  .string()
  .trim()
  .max(254)
  .email();

const recipients = z.union([email, z.array(email).min(1).max(MAX_RECIPIENTS)]);

const attachment = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(150)
    // Letters, digits, space and . _ - ( ), ending in .pdf: no paths, no
    // header-breaking characters, no double extensions that hide a type.
    .regex(/^[\w ().-]+\.pdf$/i, "Attachment must be a .pdf file"),
  content: z
    .string()
    .min(1)
    // base64 grows by 4/3; a little headroom for padding.
    .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Attachment content must be base64"),
  contentType: z.literal("application/pdf"),
});

export const emailRequestSchema = z
  .object({
    to: recipients.optional(),
    cc: z.array(email).max(MAX_RECIPIENTS).optional(),
    subject: z.string().trim().min(1).max(MAX_SUBJECT_CHARS),
    html: z.string().min(1).max(MAX_HTML_CHARS),
    attachment: attachment.optional(),
  })
  .strict()
  .refine((b) => !!b.to || (b.cc?.length ?? 0) > 0, {
    message: "At least one recipient is required",
  });

export type EmailRequest = z.infer<typeof emailRequestSchema>;

/** True when the decoded base64 starts with the PDF signature "%PDF-". */
export function looksLikePdf(base64: string): boolean {
  try {
    const head = Buffer.from(base64.slice(0, 16), "base64").subarray(0, 5);
    return head.toString("latin1") === "%PDF-";
  } catch {
    return false;
  }
}

/**
 * Domains an anonymous request may write to: the sender's own domain, plus
 * any listed in EMAIL_PUBLIC_RECIPIENT_DOMAINS (comma-separated).
 */
export function companyDomains(
  from: string | undefined = process.env.NEXT_PUBLIC_EMAIL_FROM,
  extra: string | undefined = process.env.EMAIL_PUBLIC_RECIPIENT_DOMAINS,
): string[] {
  const domains = new Set<string>();
  const fromDomain = from?.match(/@([^>\s]+)>?\s*$/)?.[1];
  if (fromDomain) domains.add(fromDomain.toLowerCase());
  for (const d of (extra ?? "").split(",")) {
    const clean = d.trim().toLowerCase();
    if (clean) domains.add(clean);
  }
  return [...domains];
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

export type EmailPolicyResult =
  | { ok: true; request: EmailRequest }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Validates a parsed body for a caller. `trusted` is a signed internal call
 * or a signed-in, active portal user; anything else is `anonymous`.
 */
export function checkEmailRequest(
  body: unknown,
  caller: "trusted" | "anonymous",
  domains: string[] = companyDomains(),
): EmailPolicyResult {
  const parsed = emailRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Invalid email request",
    };
  }
  const request = parsed.data;

  if (request.attachment && !looksLikePdf(request.attachment.content)) {
    return { ok: false, status: 400, error: "Attachment is not a PDF" };
  }

  if (caller === "anonymous") {
    const to = request.to;
    if (typeof to !== "string" || request.cc?.length || request.attachment) {
      return {
        ok: false,
        status: 403,
        error: "Not allowed without signing in",
      };
    }
    if (!domains.length || !domains.includes(domainOf(to))) {
      return {
        ok: false,
        status: 403,
        error: "Not allowed without signing in",
      };
    }
  }

  return { ok: true, request };
}
