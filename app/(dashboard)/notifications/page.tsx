import type { Metadata } from "next";

import { AmcAccessGate } from "@/components/dashboard/extensions/amc/amc-access-gate";
import { NotificationsInbox } from "@/components/dashboard/notifications/notifications-inbox";

export const metadata: Metadata = {
  title: "Notifications | YALLA FIXIT",
  robots: { index: false, follow: false },
};

/* The portal notifications inbox (BRD 6.2). AMC is the module that sends
   them today, so the AMC access rule applies. */
export default function NotificationsPage() {
  return (
    <AmcAccessGate>
      <NotificationsInbox />
    </AmcAccessGate>
  );
}
