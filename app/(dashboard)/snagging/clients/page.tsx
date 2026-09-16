import type { Metadata } from "next";

import ClientsAdmin from "@/components/dashboard/snagging/clients-admin";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Clients | Property Care";
const description =
  "Everyone snagging jobs and quotations are raised for, and the details the team reaches them on.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/clients` },
  openGraph: { title, description, url: `${baseUrl}/snagging/clients` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingClientsPage() {
  return <ClientsAdmin />;
}
