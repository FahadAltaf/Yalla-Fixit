import type { Metadata } from "next";

import { NotificationsInbox } from "@/components/dashboard/notifications/notifications-inbox";

export const metadata: Metadata = {
  title: "Notifications | YALLA FIXIT",
  robots: { index: false, follow: false },
};

/* The portal notifications inbox (BRD §6.2). Everyone signed in has one;
   the API returns only the caller's own. */
export default function NotificationsPage() {
  return <NotificationsInbox />;
}
