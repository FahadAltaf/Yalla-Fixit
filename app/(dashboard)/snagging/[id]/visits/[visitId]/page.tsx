import type { Metadata } from "next";

import VisitDetail from "@/components/dashboard/snagging/visit-detail";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>;
}): Promise<Metadata> {
  const { id, visitId } = await params;
  const title = "Additional visit | Property Care Snagging";
  const description =
    "One additional visit: who goes and when, how it is charged, what it found, and its review.";

  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: `${baseUrl}/snagging/${id}/visits/${visitId}` },
    openGraph: { title, description, url: `${baseUrl}/snagging/${id}/visits/${visitId}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function VisitPage({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>;
}) {
  const { id, visitId } = await params;
  return <VisitDetail taskId={id} visitId={visitId} />;
}
