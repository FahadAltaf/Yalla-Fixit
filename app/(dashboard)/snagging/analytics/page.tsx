import type { Metadata } from "next";

import SnaggingAnalyticsDashboard from "@/components/dashboard/snagging/analytics-dashboard";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Snagging analytics | Property Care";
const description =
  "Inspection throughput, approval performance, defect distribution, and developer snag rates.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/analytics` },
  openGraph: { title, description, url: `${baseUrl}/snagging/analytics` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingAnalyticsPage() {
  return <SnaggingAnalyticsDashboard />;
}
