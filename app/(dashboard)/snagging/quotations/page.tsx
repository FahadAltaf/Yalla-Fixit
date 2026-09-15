import type { Metadata } from "next";

import QuotationsAdmin from "@/components/dashboard/snagging/quotations-admin";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Quotations | Property Care";
const description =
  "Every price quoted for a client's property, and which of them have become jobs.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/quotations` },
  openGraph: { title, description, url: `${baseUrl}/snagging/quotations` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingQuotationsPage() {
  return <QuotationsAdmin />;
}
