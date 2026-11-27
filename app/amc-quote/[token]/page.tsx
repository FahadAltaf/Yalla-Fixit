import type { Metadata } from "next";

import { PublicQuotation, type PublicQuotationCopy } from "@/app/quote/[token]/public-quotation";

export const metadata: Metadata = {
  title: "Your quotation | Yalla Fix It",
  description: "Review and approve your quotation.",
  robots: { index: false, follow: false },
};

/*
  An AMC call out's or additional work's quotation (27 Nov 2026): the same
  page, document and steps as a Snagging quotation; only what happens next
  is said for AMC.
*/
const AMC_COPY: PublicQuotationCopy = {
  approved: "Thank you. Your approval has been recorded, and our team will be in touch to schedule the work.",
  approveMeaning: "This confirms you accept the quotation and its terms. It is final, and our team will proceed to schedule the work.",
};

export default async function AmcQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicQuotation token={token} apiBase="/api/amc-quote" copy={AMC_COPY} />;
}
