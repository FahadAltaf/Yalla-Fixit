import type { Metadata } from "next";

import HomeDashboard from "@/components/dashboard/home";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Home | YALLA FIXIT";
const description =
  "Everything sitting with you, across snagging, proposals and your own list.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/` },
};

export default function DashboardPage() {
  return <HomeDashboard />;
}
