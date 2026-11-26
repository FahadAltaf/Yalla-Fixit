import type { Metadata } from "next";

import QuotationDetail from "@/components/dashboard/snagging/quotation-detail";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Quotation | Property Care";
const description =
  "A snagging quotation, its decision, and the job it becomes once the client approves.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/quotations` },
  openGraph: { title, description, url: `${baseUrl}/snagging/quotations` },
  twitter: { card: "summary", title, description },
};

export default async function SnaggingQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuotationDetail id={id} />;
}
