import React from "react";
import { SidebarTrigger } from "../ui/sidebar";
import { Separator } from "../ui/separator";
import { HomeIcon } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import { usePathname } from "next/navigation";
import {
  labelForSegment,
  useBreadcrumbLabelVersion,
} from "./breadcrumb-labels";

type Crumb = { segment: string; href: string; label?: string };

/*
  AMC lives under /extensions/amc (proposals) and /extensions/amc-contracts
  (everything else) -- addresses kept because stored notifications and sent
  emails link there -- but it is its own module in the sidebar. The trail
  reads as that module: "AMC / Clients / Al Noor", not "Extensions / Amc
  Contracts / Customers / ...". Each crumb links to a page that exists.
*/
const AMC_HOME = "/extensions/amc-contracts";
const AMC_SECTIONS: Record<string, { label: string; href?: string }> = {
  enquiries: { label: "Enquiries" },
  customers: { label: "Clients" },
  // A property has no list of its own; it belongs to its client.
  properties: { label: "Clients", href: `${AMC_HOME}/customers` },
  assessments: { label: "Site visits" },
  "rate-card": { label: "Rate card" },
  reports: { label: "Reports" },
  settings: { label: "Operations settings" },
  "fsm-services": { label: "FSM mapping" },
  payments: { label: "Payments" },
};
const AMC_WORDS: Record<string, string> = { new: "New proposal", edit: "Edit" };

function crumbsFor(segments: string[]): Crumb[] {
  const plain = segments.map((segment, index) => ({
    segment,
    href: "/" + segments.slice(0, index + 1).join("/"),
  }));
  if (segments[0] !== "extensions" || (segments[1] !== "amc" && segments[1] !== "amc-contracts")) {
    return plain.map((crumb) => (crumb.segment === "amc" ? { ...crumb, label: "AMC" } : crumb));
  }
  const crumbs: Crumb[] = [{ segment: "amc", href: AMC_HOME, label: "AMC" }];
  const rest = plain.slice(2).map((crumb) =>
    AMC_WORDS[crumb.segment] ? { ...crumb, label: AMC_WORDS[crumb.segment] } : crumb,
  );
  if (segments[1] === "amc") {
    crumbs.push({ segment: "proposals", href: "/extensions/amc", label: "Proposals" });
    return [...crumbs, ...rest];
  }
  const section = segments[2] ? AMC_SECTIONS[segments[2]] : undefined;
  if (section) {
    crumbs.push({ segment: segments[2], href: section.href ?? rest[0].href, label: section.label });
    return [...crumbs, ...rest.slice(1)];
  }
  // The contracts list itself, or one contract.
  crumbs.push({ segment: "contracts", href: AMC_HOME, label: "Contracts" });
  return [...crumbs, ...rest];
}

const DashboardHeader = () => {
  const pathname = usePathname();

  const segments = React.useMemo(
    () => pathname.split("/").filter(Boolean),
    [pathname],
  );
  const crumbs = React.useMemo(() => crumbsFor(segments), [segments]);

  // Re-reads when a record page registers a name for its id segment.
  void useBreadcrumbLabelVersion();
  return (
    <header className="before:bg-background/60 sticky top-0 z-50 before:absolute before:inset-0 before:mask-[linear-gradient(var(--card),var(--card)_18%,transparent_100%)] before:backdrop-blur-md">
      <div className="bg-card relative z-51 mx-auto mt-3 flex w-[calc(100%-2rem)] items-center justify-between rounded-xl border px-6 py-2 sm:w-[calc(100%-3rem)]">
        <div className="flex items-center gap-1.5 sm:gap-4">
          <SidebarTrigger className="[&_svg]:!size-5" />
          <Separator orientation="vertical" className="hidden !h-8 sm:block" />
          <Breadcrumb>
            {/* Sized to sit level with the sidebar toggle: the default
                14px text and 15px icon read small in a 56px bar. */}
            <BreadcrumbList className="gap-2 text-[15px] sm:gap-2.5">
              <BreadcrumbItem>
                <BreadcrumbLink
                  href="/"
                  className="hover:bg-muted flex size-8 items-center justify-center rounded-md"
                >
                  <HomeIcon aria-hidden="true" className="size-[18px]" />
                  <span className="sr-only">Home</span>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {segments.length === 0 && (
                <>
                  <BreadcrumbSeparator className="text-muted-foreground/50"> / </BreadcrumbSeparator>
                  <BreadcrumbItem>
                    <BreadcrumbPage className="font-semibold">Dashboard</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
              {crumbs.map(({ segment, href, label: fixed }, index) => {
                const isLast = index === crumbs.length - 1;
                // A page that knows its own name supplies one; otherwise
                // the segment is title-cased. Without this a record page
                // showed its raw id as the page title.
                const registered = labelForSegment(segment);
                // An id the page has not named (yet, or at all) reads as
                // "Details" -- never as a title-cased UUID.
                const isId =
                  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                    segment,
                  );
                const label =
                  registered ??
                  fixed ??
                  (isId
                    ? "Details"
                    : decodeURIComponent(segment)
                        .replace(/-/g, " ")
                        .replace(/\b\w/g, (char) => char.toUpperCase()));

                return (
                  <React.Fragment key={`${index}:${href}`}>
                    <BreadcrumbSeparator className="text-muted-foreground/50"> / </BreadcrumbSeparator>
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage className="font-semibold">{label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
          {/* <SearchDialog
            trigger={
              <>
                <Button
                  variant="ghost"
                  className="hidden !bg-transparent px-1 py-0 font-normal sm:block"
                >
                  <div className="text-muted-foreground hidden items-center gap-1.5 text-sm sm:flex">
                    <SearchIcon />
                    <span>Type to search...</span>
                  </div>
                </Button>
                <Button variant="ghost" size="icon" className="sm:hidden">
                  <SearchIcon />
                  <span className="sr-only">Search</span>
                </Button>
              </>
            }
          /> */}
        </div>
        <div className="flex items-center gap-1.5">
          {/* <ActivityDialog
            trigger={
              <Button variant="ghost" size="icon">
                <ActivityIcon />
              </Button>
            }
          />
          <NotificationDropdown
            trigger={
              <Button variant="ghost" size="icon" className="relative">
                <BellIcon />
                <span className="bg-destructive absolute top-2 right-2.5 size-2 rounded-full" />
              </Button>
            }
          /> */}
          {/* The account moved to the foot of the sidebar, where it
              can carry a name and an email. What is left here is the one
              control that belongs to the view rather than the account. */}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
