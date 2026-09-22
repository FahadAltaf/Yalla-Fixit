import { EMAIL_LOGO_CID } from "@/lib/email-brand";
import { EMAIL_LOGO_PNG_BASE64 } from "@/lib/email-logo";

/**
 * Adds the embedded Yalla Fix It logo to a message whose HTML refers to it
 * (see emailMasthead / clientEmailHtml in lib/email-brand.ts). Server only,
 * so the image data never reaches the browser bundle.
 */
export type EmailAttachment = {
  filename?: string;
  content: Buffer;
  contentType?: string;
  contentId?: string;
};

export function withInlineLogo(
  html: string,
  attachments: EmailAttachment[] = [],
): EmailAttachment[] | undefined {
  if (!html.includes(`cid:${EMAIL_LOGO_CID}`)) {
    return attachments.length > 0 ? attachments : undefined;
  }
  if (attachments.some((item) => item.contentId === EMAIL_LOGO_CID)) {
    return attachments;
  }
  return [
    ...attachments,
    {
      filename: "yalla-fix-it.png",
      content: Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64"),
      contentType: "image/png",
      contentId: EMAIL_LOGO_CID,
    },
  ];
}
