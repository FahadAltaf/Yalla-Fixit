import { cookies } from "next/headers";
import SchedulingShell from "@/components/dashboard/scheduling/scheduling-shell";
import { SCHEDULING_NAV_COOKIE } from "@/lib/scheduling/nav-preference";

// Both scheduling sections share the sidebar navigation, so it lives in a
// layout: it renders once and survives navigation between the two routes
// instead of being re-mounted by each page.
//
// The collapsed/expanded preference is read here, on the server, so the nav
// renders at its correct width on the very first paint -- reading it in the
// browser instead would flash the wrong width on every page load.
export default async function SchedulingLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  // Collapsed unless the user has explicitly opened it: the board is the
  // point of the page, and the section nav is two items.
  const navOpen = store.get(SCHEDULING_NAV_COOKIE)?.value === "open";

  return <SchedulingShell defaultNavOpen={navOpen}>{children}</SchedulingShell>;
}
