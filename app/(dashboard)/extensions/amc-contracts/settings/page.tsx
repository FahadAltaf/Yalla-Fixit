import type { Metadata } from "next";

import { AmcOpsSettings } from "@/components/dashboard/extensions/amc-contracts/amc-ops-settings";

export const metadata: Metadata = {
  title: "Settings | AMC contracts",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <AmcOpsSettings />;
}
