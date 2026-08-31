import type { Metadata } from "next";

import DesnagBuilder from "@/components/dashboard/snagging/desnag-builder";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const title = "De-snag round | Property Care Snagging";
  const description = "Choose which outstanding snags carry forward into a re-inspection round.";

  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: `${baseUrl}/snagging/${id}/desnag` },
    openGraph: { title, description, url: `${baseUrl}/snagging/${id}/desnag` },
    twitter: { card: "summary", title, description },
  };
}

export default async function DesnagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DesnagBuilder taskId={id} />;
}
