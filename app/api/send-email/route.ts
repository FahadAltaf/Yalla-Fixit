import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.NEXT_PUBLIC_RESEND_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { to, subject, html, cc, attachment } = await request.json();

    const attachments = attachment
      ? [
          {
            filename: attachment.filename,
            content: Buffer.from(attachment.content, "base64"),
            contentType: attachment.contentType,
          },
        ]
      : undefined;

    let primaryTo = to as string | undefined;
    let ccList = cc as string[] | undefined;

    if (ccList && ccList.length === 1) {
      if (!primaryTo) {
        primaryTo = ccList[0];
      }
      ccList = undefined;
    } else if (ccList && ccList.length > 1 && !primaryTo) {
      primaryTo = ccList[0];
      ccList = ccList.slice(1);
    }

    const emailOptions = {
      ...(primaryTo ? { to: primaryTo } : {}),
      ...(ccList && ccList.length > 0 ? { cc: ccList } : {}),
      from: process.env.NEXT_PUBLIC_EMAIL_FROM!,
      subject,
      html,
      attachments,
    };

    const data = await resend.emails.send(emailOptions as any);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}