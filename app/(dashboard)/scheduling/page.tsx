import type { Metadata } from "next";
import { listTechnicians } from "@/modules/scheduling";
import { refreshTechniciansIfStale } from "@/lib/server/zoho/service-resources";
import DailyScheduleDashboard from "@/components/dashboard/scheduling/daily-schedule";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Daily Schedule | Scheduling";
const description = "Daily day/night scheduling dashboard synced with Zoho FSM.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: `${baseUrl}/scheduling`,
  },
  openGraph: {
    title,
    description,
    url: `${baseUrl}/scheduling`,
  },
};

export default async function SchedulingPage() {
  // Top the FSM roster up if the cache has aged out (6h). This is what
  // replaces the every-30-minutes pg_cron refresh: the roster changes a few
  // times a month, so doing the work when someone opens the screen costs a
  // fraction of the Zoho calls. Never throws -- a stale roster beats a
  // failed page load.
  await refreshTechniciansIfStale();
  const technicians = await listTechnicians();

  return <DailyScheduleDashboard technicians={technicians} />;
}
