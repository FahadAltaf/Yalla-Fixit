/**
 * The home dashboard (26 Nov 2026, the user: "update dashboard of portal
 * according to approver, admin, role based user ... the dashboard page is the
 * one that access to each user"). Every signed-in user opens it; what it
 * shows follows what they hold across the whole portal:
 *
 *   approvals  decisions waiting for this person (AMC proposals, amendments
 *              and site visits, schedules, Snagging reviews and sign-offs,
 *              Finance and compliance decisions)
 *   work       what is assigned to them or sits in a queue they own
 *   overview   each module they can open, in one figure
 *   admin      the portal's health, for administrators
 *
 * Shapes only; lib/server/home/summary.ts fills them.
 */

export type HomeModule =
  | "amc"
  | "snagging"
  | "scheduling"
  | "invoicing"
  | "compliance"
  | "todos"
  | "workforce"
  | "clients"
  | "admin";

export type HomeTone = "neutral" | "progress" | "review" | "good" | "bad";

export type HomeItem = {
  key: string;
  module: HomeModule;
  /** What it is, e.g. "Proposals to approve". */
  title: string;
  /** One line under it, e.g. "Oldest waiting 3 days". */
  detail: string | null;
  count: number;
  tone: HomeTone;
  href: string;
};

export type HomeRole = {
  /** The role's name as set up in Roles. */
  name: string | null;
  isAdmin: boolean;
  /** Decides something somewhere in the portal (any approval right). */
  isApprover: boolean;
};

/** One bar of a chart: its value, its colour token, and the list it opens (`drill`) or the page (`href`). */
export type HomeChartPoint = {
  key: string;
  label: string;
  value: number;
  /** A CSS colour token (lib/snagging/chart-palette.ts), never a literal. */
  color: string;
  drill?: string;
  href?: string;
};

export type HomeChart = {
  key: string;
  module: HomeModule;
  title: string;
  description: string;
  /** Bars down the side (categories with long names) or along the bottom (days). */
  layout: "horizontal" | "vertical";
  points: HomeChartPoint[];
  /** What the values count, e.g. "Jobs". */
  unit: string;
};

export type HomeSummary = {
  role: HomeRole;
  /** Module charts this person can open (Snagging pipeline, PPM month, the next days' board, document expiry). */
  charts: HomeChart[];
  approvals: HomeItem[];
  work: HomeItem[];
  overview: HomeItem[];
  /** Null for anyone who is not an administrator. */
  admin: HomeItem[] | null;
  /** Sections that could not be read this time (the rest still show). */
  unavailable: string[];
  generatedAt: string;
};

export const HOME_MODULE_LABELS: Record<HomeModule, string> = {
  amc: "AMC",
  snagging: "Snagging",
  scheduling: "Scheduling",
  invoicing: "Invoicing",
  compliance: "Compliance",
  todos: "To-dos",
  workforce: "Workforce",
  clients: "Clients",
  admin: "Administration",
};

/** Only items with something in them, biggest first within the same tone. */
export function nonEmpty(items: HomeItem[]): HomeItem[] {
  const weight: Record<HomeTone, number> = { bad: 0, review: 1, progress: 2, neutral: 3, good: 4 };
  return items.filter((i) => i.count > 0).sort((a, b) => weight[a.tone] - weight[b.tone] || b.count - a.count);
}

/** "Good morning" by the Dubai clock. */
export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
