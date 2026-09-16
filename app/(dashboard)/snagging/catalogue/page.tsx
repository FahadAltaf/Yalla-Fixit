import type { Metadata } from "next";

import CatalogueTreeAdmin from "@/components/dashboard/snagging/catalogue-tree-admin";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Snag catalogue | Property Care";
const description =
  "The controlled defect taxonomy every captured snag is classified against, owned by Operations.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/catalogue` },
  openGraph: { title, description, url: `${baseUrl}/snagging/catalogue` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingCataloguePage() {
  return <CatalogueTreeAdmin />;
}
