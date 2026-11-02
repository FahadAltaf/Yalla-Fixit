"use client";

import { usePathname } from "next/navigation";

// The Scheduling module's frame. It used to carry a section sidebar (Daily
// Schedule, Technicians & Leave) and wrap the page in one large card. Since
// Technicians & Leave moved to Workforce → People, Daily Schedule is the only
// section, so the sidebar came off (2 Nov) and the page lays out like every
// other page: its heading on the page, each part in its own card.
export default function SchedulingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The wall display is a full-bleed screen inside this route subtree.
  if (pathname.startsWith("/scheduling/display")) return <>{children}</>;

  return <div className="flex min-w-0 flex-col gap-6">{children}</div>;
}
