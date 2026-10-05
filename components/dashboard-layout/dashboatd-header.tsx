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

const DashboardHeader = () => {
  const pathname = usePathname();

  const segments = React.useMemo(
    () => pathname.split("/").filter(Boolean),
    [pathname],
  );

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
              {segments.map((segment, index) => {
                const href = "/" + segments.slice(0, index + 1).join("/");
                const isLast = index === segments.length - 1;
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
                  (isId
                    ? "Details"
                    : decodeURIComponent(segment)
                        .replace(/-/g, " ")
                        .replace(/\b\w/g, (char) => char.toUpperCase()));

                return (
                  <React.Fragment key={href}>
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
