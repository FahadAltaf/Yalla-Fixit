import type { Metadata } from "next";

import ClientsAdmin from "@/components/dashboard/snagging/clients-admin";
import { canSeeSnaggingPage } from "@/lib/server/snagging/page-access";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { ResourceType } from "@/types/types";
import { listClients } from "@/lib/server/snagging/client-list";
import { fsmClientsReady, listFsmClients } from "@/lib/server/snagging/fsm-clients";
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
 * The first page of clients, read here on the server so it arrives with
 * the page: from Zoho FSM, where the clients are kept, or the portal's own
 * when the FSM integration is off. Same queries as the API. Anyone without
 * access, or a failed read, gets no data here and the table asks itself.
 */
async function firstPage(): Promise<{
  data: SnaggingClientOption[];
  hasMore: boolean;
  source: "fsm" | "portal";
} | null> {
  try {
    if (!(await canSeeSnaggingPage(ResourceType.SNAGGING_CLIENTS))) return null;
    const admin = await createAdminServerClient();
    if (await fsmClientsReady(admin)) {
      const result = await listFsmClients(admin, { page: 0, perPage: 10 });
      return { ...(result as { data: SnaggingClientOption[]; hasMore: boolean }), source: "fsm" };
    }
    const result = await listClients(
      admin,
      new URLSearchParams({ with_counts: "true", page: "0", pageSize: "10" }),
    );
    return {
      data: result.data as unknown as SnaggingClientOption[],
      hasMore: 10 < (result.totalCount ?? 0),
      source: "portal",
    };
  } catch (error) {
    console.error("Clients first page (server) failed; the table will fetch it:", error);
    return null;
  }
}

export default async function SnaggingClientsPage() {
  /* The permission decides the page, not just the sidebar entry. */
  if (!(await canSeeSnaggingPage(ResourceType.SNAGGING_CLIENTS))) return <NoPageAccess page="Clients" />;

  return <ClientsAdmin initial={await firstPage()} />;
}
