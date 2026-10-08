import type { Metadata } from "next";

import { AmcOpsSettings } from "@/components/dashboard/extensions/amc-contracts/amc-ops-settings";

export const metadata: Metadata = {
  title: "Operations settings | AMC",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <AmcOpsSettings />;
}
