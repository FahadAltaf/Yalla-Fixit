import SchedulingShell from "@/components/dashboard/scheduling/scheduling-shell";

// Both scheduling sections share the sidebar navigation, so it lives in a
// layout: it renders once and survives navigation between the two routes
// instead of being re-mounted by each page.
export default function SchedulingLayout({ children }: { children: React.ReactNode }) {
  return <SchedulingShell>{children}</SchedulingShell>;
}
