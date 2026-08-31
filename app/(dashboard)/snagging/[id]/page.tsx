import type { Metadata } from "next";

import InspectionDetail from "@/components/dashboard/snagging/inspection-detail";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

/**
 * The title carries the inspection id rather than a generic label so a
 * manager with several review tabs open can tell them apart. Content is
 * loaded client-side because the same screen is used mid-approval and
 * needs to refresh after each action without a full navigation.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const title = `Inspection ${id.slice(0, 8)} | Property Care Snagging`;
  const description =
    "Review captured defects, photo evidence, and area coverage before approving the client report.";

  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: `${baseUrl}/snagging/${id}` },
    openGraph: { title, description, url: `${baseUrl}/snagging/${id}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function SnaggingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InspectionDetail taskId={id} />;
}
