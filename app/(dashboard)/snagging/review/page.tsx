import type { Metadata } from "next";

import ReviewWorkspace from "@/components/dashboard/snagging/review-workspace";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Review inspections | Property Care Snagging";
const description =
  "Walk submitted inspections snag by snag, then approve or send them back with a reason.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/review` },
  openGraph: { title, description, url: `${baseUrl}/snagging/review` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingReviewPage() {
  return <ReviewWorkspace />;
}
