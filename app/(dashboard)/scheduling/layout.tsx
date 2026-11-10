import SchedulingShell from "@/components/dashboard/scheduling/scheduling-shell";

// The Scheduling module's frame, shared by its routes (the board and the
// wall display). No section sidebar since 2 Nov: Daily Schedule is the only
// section left (Technicians & Leave is Workforce → People).
export default function SchedulingLayout({ children }: { children: React.ReactNode }) {
  return <SchedulingShell>{children}</SchedulingShell>;
}
