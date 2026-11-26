import { redirect } from "next/navigation";

import { clientHref } from "@/lib/clients/access";

/*
  Clients is one module for AMC and Snagging now (26 Nov 2026). A client's
  old AMC address (in notifications and emails already sent) forwards to
  its page there, on the same tab.
*/
export default async function AmcClientRoute({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ customerId }, query] = await Promise.all([params, searchParams]);
  const tab = typeof query.tab === "string" ? query.tab : null;
  redirect(clientHref(customerId, tab));
}
