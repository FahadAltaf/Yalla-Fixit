"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { AmcNotificationsBell } from "./amc-notifications-bell";

const SECTIONS = [
  { key: "contracts", label: "Contracts", href: "/extensions/amc-contracts" },
  {
    key: "enquiries",
    label: "Enquiries",
    href: "/extensions/amc-contracts/enquiries",
  },
  {
    key: "customers",
    label: "Customers",
    href: "/extensions/amc-contracts/customers",
  },
  {
    key: "assessments",
    label: "Assessments",
    href: "/extensions/amc-contracts/assessments",
  },
  {
    key: "rate-card",
    label: "Rate card",
    href: "/extensions/amc-contracts/rate-card",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/extensions/amc-contracts/reports",
  },
  {
    key: "settings",
    label: "Settings",
    href: "/extensions/amc-contracts/settings",
  },
  {
    key: "fsm-services",
    label: "FSM mapping",
    href: "/extensions/amc-contracts/fsm-services",
  },
  { key: "proposals", label: "AMC proposals", href: "/extensions/amc" },
] as const;

export type AmcSection = (typeof SECTIONS)[number]["key"];

/** The AMC area's sections, so no page is a dead end, and the AMC notifications. */
export function AmcSectionNav({ current }: { current: AmcSection }) {
  return (
    <div className="flex items-center gap-2">
      <nav
        aria-label="AMC sections"
        className="-mx-1 min-w-0 flex-1 overflow-x-auto"
      >
        <ul className="flex min-w-max gap-1 px-1">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                aria-current={s.key === current ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full px-3 text-sm transition-colors",
                  s.key === current
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <AmcNotificationsBell className="shrink-0" />
    </div>
  );
}
