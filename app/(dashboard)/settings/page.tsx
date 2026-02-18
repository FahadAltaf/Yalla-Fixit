import Settings from "@/components/dashboard/settings";
import type { Metadata } from "next";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Settings | Dashboard Configuration";
const description =
  "Configure application-wide settings and preferences for the Kaizen yallafixit dashboard.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: `${baseUrl}/settings`,
  },
  openGraph: {
    title,
    description,
    url: `${baseUrl}/settings`,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function SettingsPage() {
  return <Settings />;
}
