import type { Metadata } from "next";

import ChecklistAdmin from "@/components/dashboard/snagging/checklist-admin";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Checklist library | Property Care";
const description =
  "The master list of checks an inspector works through on site, set per property type and owned by Operations.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/checklist` },
  openGraph: { title, description, url: `${baseUrl}/snagging/checklist` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingChecklistPage() {
  return <ChecklistAdmin />;
}
