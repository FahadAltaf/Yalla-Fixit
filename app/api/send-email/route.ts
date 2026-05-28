import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_RESEND_API_KEY;
    const from = process.env.NEXT_PUBLIC_EMAIL_FROM;

    if (!apiKey || !from) {
      return NextResponse.json(
        { error: "Email service is not configured" },
        { status: 500 }
      );
    }

    const resend = new Resend(apiKey);
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
      from,
      subject,
      html,
      attachments,
    };

    const { data, error } = await resend.emails.send(emailOptions as any);

    if (error) {
      console.error("Resend email error:", error);
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
