import type { ReactNode } from "react";

import { AmcAccessGate } from "@/components/dashboard/extensions/amc/amc-access-gate";

/* The same gate as AMC proposals: AMC view or approve. */
export default function AmcContractsLayout({ children }: { children: ReactNode }) {
  return <AmcAccessGate>{children}</AmcAccessGate>;
}
