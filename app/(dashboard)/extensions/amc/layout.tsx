import type { ReactNode } from "react";

import { AmcAccessGate } from "@/components/dashboard/extensions/amc/amc-access-gate";

/* One gate for every AMC page: the list, a proposal, the wizard. */
export default function AmcLayout({ children }: { children: ReactNode }) {
  return <AmcAccessGate>{children}</AmcAccessGate>;
}
