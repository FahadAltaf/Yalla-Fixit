import type { Metadata } from "next";

import { ClientsPage } from "@/components/dashboard/clients/clients-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeClientsPage } from "@/lib/server/clients/page-access";

export const metadata: Metadata = {
  title: "Clients",
  robots: { index: false, follow: false },
};

/* One Clients module for AMC and Snagging (26 Nov 2026); either module's Clients permission opens it. */
export default async function Route() {
  if (!(await canSeeClientsPage())) return <NoPageAccess page="Clients" />;
  return <ClientsPage />;
}
