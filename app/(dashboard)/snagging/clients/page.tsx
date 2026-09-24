import type { Metadata } from "next";

import ClientsAdmin from "@/components/dashboard/snagging/clients-admin";
import { canViewSnagging } from "@/lib/server/snagging/page-access";
import { listClients } from "@/lib/server/snagging/client-list";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import type { SnaggingClientOption } from "@/modules/snagging";

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

/**
 * The first page of clients, with their job counts, read here on the
 * server so it arrives with the page. Same query as the API (listClients).
 * Anyone without Snagging access, or a failed read, gets no data here and
 * the table asks for it itself.
 */
async function firstPage() {
  try {
    if (!(await canViewSnagging())) return null;
    const admin = await createAdminServerClient();
    const result = await listClients(
      admin,
      new URLSearchParams({ with_counts: "true", page: "0", pageSize: "10" }),
    );
    return result as unknown as { data: SnaggingClientOption[]; totalCount: number };
  } catch (error) {
    console.error("Clients first page (server) failed; the table will fetch it:", error);
    return null;
  }
}

export default async function SnaggingClientsPage() {
  return <ClientsAdmin initial={await firstPage()} />;
}
