import type { Metadata } from "next";

import { PublicAmcDocument } from "./public-amc-document";

export const metadata: Metadata = {
  title: "Your AMC | Yalla Fix It",
  description: "Review and approve your annual maintenance contract.",
  /* NFR4 — the link is unguessable, but it should also never be indexed
     if one ends up somewhere crawlable. The API sends X-Robots-Tag too. */
  robots: { index: false, follow: false },
};

export default async function PublicAmcPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicAmcDocument token={token} />;
}
