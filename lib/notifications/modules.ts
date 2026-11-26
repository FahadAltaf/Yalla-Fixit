/**
 * The portal's notifications by module (26 Nov 2026, the user: "managed
 * according to Snagging, Invoicing, AMC and the other menus"). One inbox,
 * filtered by the part of the portal a notice comes from.
 *
 * AMC keeps its own store (amc_notifications); everything else is in
 * portal_notifications, and its module is read from the event name:
 *   finance.*                        Invoicing
 *   snagging.*                       Snagging
 *   scheduling.*, capacity overbook  Scheduling
 *   check-in alerts                  Workforce
 *   reports.compliance_*             Compliance
 *   todos.*                          To-dos
 *   other reports.*                  Reports
 */
export const NOTIFICATION_MODULES = ["amc", "snagging", "invoicing", "scheduling", "workforce", "compliance", "todos", "reports"] as const;
export type NotificationModule = (typeof NOTIFICATION_MODULES)[number];

export const NOTIFICATION_MODULE_LABELS: Record<NotificationModule, string> = {
  amc: "AMC",
  snagging: "Snagging",
  invoicing: "Invoicing",
  scheduling: "Scheduling",
  workforce: "Workforce",
  compliance: "Compliance",
  todos: "To-dos",
  reports: "Reports",
};

export const WORKFORCE_EVENTS = ["reports.shift_check_in_missed", "reports.appointment_check_in_missed"] as const;
export const SCHEDULING_REPORT_EVENTS = ["reports.capacity_overbooked"] as const;

export const isNotificationModule = (value: unknown): value is NotificationModule =>
  typeof value === "string" && (NOTIFICATION_MODULES as readonly string[]).includes(value);

/** The module a notice belongs to. `source` is the store it came from. */
export function moduleOfEvent(event: string, source: "amc" | "portal" = "portal"): NotificationModule {
  if (source === "amc") return "amc";
  if (event.startsWith("finance.")) return "invoicing";
  if (event.startsWith("snagging.")) return "snagging";
  if (event.startsWith("scheduling.") || (SCHEDULING_REPORT_EVENTS as readonly string[]).includes(event)) return "scheduling";
  if ((WORKFORCE_EVENTS as readonly string[]).includes(event)) return "workforce";
  if (event.startsWith("reports.compliance")) return "compliance";
  if (event.startsWith("todos.")) return "todos";
  if (event.startsWith("amc.")) return "amc";
  return "reports";
}
