import type { Metadata } from "next";

import { PpmMonthPage } from "@/components/dashboard/extensions/amc-contracts/ppm-month-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "PPM month | AMC",
  robots: { index: false, follow: false },
};

/* DEV-492: the coordinators' month of planned visits; the AMC Visits page permission opens it. */
export default async function PpmMonthRoute() {
  if (!(await canSeeAmcPage(ResourceType.AMC_VISITS))) return <NoPageAccess page="PPM month" />;
  return <PpmMonthPage />;
}
