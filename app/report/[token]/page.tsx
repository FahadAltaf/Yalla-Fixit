import type { Metadata } from "next";

import { PublicReport } from "./public-report";

// A private client link: never index it.
export const metadata: Metadata = {
  title: "Inspection report",
  robots: { index: false, follow: false },
};

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicReport token={token} />;
}
