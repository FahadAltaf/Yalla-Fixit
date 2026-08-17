import type { Metadata } from "next";

import SnaggingOverviewDashboard from "@/components/dashboard/snagging/overview-dashboard";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Today at a glance | Property Care Snagging";
const description =
  "The day's snagging work at a glance: jobs in flight, inspections waiting on review, and open snags by severity.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging` },
  openGraph: { title, description, url: `${baseUrl}/snagging` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingPage() {
  return <SnaggingOverviewDashboard />;
}
