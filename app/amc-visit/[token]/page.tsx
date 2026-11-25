import type { Metadata } from "next";

import { ClientVisitLink } from "./client-visit-link";

export const metadata: Metadata = {
  title: "Your AMC visit | Yalla Fix It",
  description: "Confirm your AMC visit, ask for another date, or upload the gate pass.",
  robots: { index: false, follow: false },
};

/* DEV-507 / DEV-494 (22 Nov 2026): the client's visit link, without a login. */
export default async function ClientVisitLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientVisitLink token={token} />;
}
