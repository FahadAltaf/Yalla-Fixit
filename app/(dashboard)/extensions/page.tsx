import type { Metadata } from "next";

import { siteConfig } from "@/lib/site-config";
import { ExtensionsPageClient } from "@/components/extensions/extensions-page";

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

export default function ExtensionsPage() {
  return <ExtensionsPageClient />;
}

