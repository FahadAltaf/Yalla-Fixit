import type { Metadata } from "next";

import { FsmServiceMapping } from "@/components/dashboard/extensions/amc-contracts/fsm-service-mapping";

export const metadata: Metadata = {
  title: "FSM service mapping | AMC",
  robots: { index: false, follow: false },
};

export default function FsmServiceMappingRoute() {
  return <FsmServiceMapping />;
}
