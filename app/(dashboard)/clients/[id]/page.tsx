import type { Metadata } from "next";

import { ClientDetail } from "@/components/dashboard/clients/client-detail";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeClientsPage } from "@/lib/server/clients/page-access";

export const metadata: Metadata = {
  title: "Client",
  robots: { index: false, follow: false },
};

export default async function Route({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canSeeClientsPage())) return <NoPageAccess page="Clients" />;
  const { id } = await params;
  return <ClientDetail id={id} />;
}
