import type { Metadata } from "next";

import { NewEnquiryPage } from "@/components/dashboard/extensions/amc-contracts/enquiries/new-enquiry-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "New enquiry | AMC",
  robots: { index: false, follow: false },
};

/** Log an enquiry on a page of its own, as a quotation is; ?client= starts from that client. */
export default async function Route({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  if (!(await canSeeAmcPage(ResourceType.AMC_ENQUIRIES)))
    return <NoPageAccess page="Enquiries" />;
  const { client } = await searchParams;
  return (
    <NewEnquiryPage
      initialClientId={
        client && /^[0-9a-f-]{36}$/i.test(client) ? client : null
      }
    />
  );
}
