"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/actions/utils";

const TABS = [
  { href: "/scheduling", label: "Daily schedule" },
  { href: "/scheduling/technicians", label: "Technicians & leave" },
];

/**
 * Scheduling section tabs, in the Kaizen pill shape used on the jobs
 * table so the two modules navigate the same way. The active tab is a
 * solid brand pill; the rest are hairline outlines.
 */
export default function SchedulingNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pt-4 md:px-6">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "border-brand bg-brand text-white"
                : "border-border text-ink-soft hover:bg-mist-soft",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
