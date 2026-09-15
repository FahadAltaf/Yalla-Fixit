import { Resend } from "resend";

/**
 * Sends an email from server code, in process.
 *
 * `emailService.sendEmail` reaches Resend by making an HTTP request from
 * the server to the server's own `/api/send-email`. That is the only way
 * to do it from the browser, and two client components still need it, so
 * it stays. From a route handler it is a round trip the process did not
 * have to make, and it is not free: Sami's 10 September log has one taking
 * thirty seconds, which held the quotation request open long enough for
 * the Supabase write that followed it to fail on a dead socket (BA v2,
 * change 35).
 *
 * Server code calls this instead. Same Resend call, same envelope
 * handling, same `{ data }` shape back — one less hop, and no dependency
 * on `NEXT_PUBLIC_APP_URL` resolving to something the server can reach,
 * which behind a proxy or in a container it often cannot.
 */
export type SendEmailInput = {
  to?: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  attachment?: {
    filename: string;
    /** base64, as the browser produced it. */
    content: string;
    contentType: string;
  };
};

export async function sendEmail({
  to,
  subject,
  html,
  cc,
  attachment,
}: SendEmailInput): Promise<{ data: { id?: string } | null }> {
  const apiKey = process.env.NEXT_PUBLIC_RESEND_API_KEY;
  const from = process.env.NEXT_PUBLIC_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Email service is not configured");

  /*
    The same envelope rules the HTTP route applies, kept identical on
    purpose: a single cc and no to becomes the to, because Resend rejects a
    message addressed to nobody.
  */
  let primaryTo = to;
  let ccList = cc;
  if (ccList && ccList.length === 1) {
    if (!primaryTo) primaryTo = ccList[0];
    ccList = undefined;
  } else if (ccList && ccList.length > 1 && !primaryTo) {
    primaryTo = ccList[0];
    ccList = ccList.slice(1);
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    ...(primaryTo ? { to: primaryTo } : {}),
    ...(ccList && ccList.length > 0 ? { cc: ccList } : {}),
    from,
    subject,
    html,
    attachments: attachment
      ? [
          {
            filename: attachment.filename,
            content: Buffer.from(attachment.content, "base64"),
            contentType: attachment.contentType,
          },
        ]
      : undefined,
  } as Parameters<Resend["emails"]["send"]>[0]);

  if (error) {
    // Resend reports a refusal in the body rather than by throwing, so it
    // has to be turned into one or the caller reads it as success.
    throw new Error(error.message ?? "Resend refused the message");
  }

  return { data: data ?? null };
}
