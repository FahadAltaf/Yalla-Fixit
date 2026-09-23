import type { Metadata } from "next";

import { ExtensionsPageClient } from "@/components/dashboard/extensions/bulk-download";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Bulk download | Extensions";
const description =
  "Search service appointments by name, view their details, and download their attachments in bulk.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/extensions/bulk-download` },
  openGraph: { title, description, url: `${baseUrl}/extensions/bulk-download` },
  twitter: { card: "summary", title, description },
};

export default function BulkDownloadPage() {
  return <ExtensionsPageClient />;
}
