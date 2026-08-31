import type { Metadata } from "next";
import { cookies } from "next/headers";
import { EXTENSIONS_NAV_COOKIE } from "@/lib/extensions/nav-preference";

import { siteConfig } from "@/lib/site-config";
import Extensions from "@/components/dashboard/extensions";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Extensions | Service Appointment Lookup";
const description =
  "Search and manage service appointments by name, view details, and download related attachments in bulk.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: `${baseUrl}/extensions`,
  },
  openGraph: {
    title,
    description,
    url: `${baseUrl}/extensions`,
    siteName: siteConfig.name,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

// The section-nav collapsed state is read here, on the server, so the nav
// renders at its correct width on the first paint instead of correcting
// itself after mount.
export default async function ExtensionsPage() {
  const store = await cookies();
  const navOpen = store.get(EXTENSIONS_NAV_COOKIE)?.value === "open";

  return <Extensions defaultNavOpen={navOpen} />;
}

