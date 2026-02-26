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

    const data = await resend.emails.send({
      from: process.env.NEXT_PUBLIC_EMAIL_FROM!,
      to,
      subject,
      html,
      cc,
      attachments,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}