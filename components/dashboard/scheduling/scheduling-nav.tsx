"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/actions/utils";

const TABS = [
  { href: "/scheduling", label: "Daily Schedule" },
  { href: "/scheduling/technicians", label: "Technicians & Leave" },
];

export default function SchedulingNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b px-4 pt-2 md:px-6">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
