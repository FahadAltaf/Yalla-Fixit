import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.NEXT_PUBLIC_RESEND_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { to, subject, html } = await request.json();
    const data = await resend.emails.send({
        from: process.env.NEXT_PUBLIC_EMAIL_FROM!,
        to,
        subject,
        html,
      });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}