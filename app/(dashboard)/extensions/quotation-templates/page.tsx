import type { Metadata } from "next";

import { QuotationTemplatesPage } from "@/components/dashboard/extensions/quotation-templates";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Quotation templates | Extensions";
const description = "Build, preview, download and share quotations from a template.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/extensions/quotation-templates` },
  openGraph: { title, description, url: `${baseUrl}/extensions/quotation-templates` },
  twitter: { card: "summary", title, description },
};

export default function QuotationTemplatesRoute() {
  return <QuotationTemplatesPage />;
}
