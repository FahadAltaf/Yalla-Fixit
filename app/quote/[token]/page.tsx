import type { Metadata } from "next";

import { PublicQuotation } from "./public-quotation";

export const metadata: Metadata = {
  title: "Your quotation | Yalla Fix It",
  description: "Review and approve your snagging inspection quotation.",
  robots: { index: false, follow: false },
};

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicQuotation token={token} />;
}
