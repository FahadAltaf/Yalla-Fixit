import type { Metadata } from "next";

import { ReportView } from "@/components/dashboard/snagging/report-view";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const title = "Inspection report | Property Care Snagging";
  const description = "The client-facing snagging report: defects by area, checklist, and sign-off.";

  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: `${baseUrl}/snagging/${id}/report` },
    openGraph: { title, description, url: `${baseUrl}/snagging/${id}/report` },
    twitter: { card: "summary", title, description },
  };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportView taskId={id} />;
}
