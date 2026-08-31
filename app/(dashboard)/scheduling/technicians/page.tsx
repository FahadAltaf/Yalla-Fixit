import type { Metadata } from "next";
import { listTechnicians } from "@/modules/scheduling";
import { refreshTechniciansIfStale } from "@/lib/server/zoho/service-resources";
import SchedulingDashboard from "@/components/dashboard/scheduling";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Technicians & leave | Scheduling";
const description = "Technicians, leave, and tags synced from Zoho FSM for the scheduling module.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: `${baseUrl}/scheduling/technicians`,
  },
  openGraph: {
    title,
    description,
    url: `${baseUrl}/scheduling/technicians`,
  },
};

export default async function TechniciansPage() {
  // Replaces the every-30-minutes pg_cron refresh: pull the roster from Zoho
  // FSM only when the cache has aged past 6h and someone is actually looking.
  await refreshTechniciansIfStale();
  const technicians = await listTechnicians();

  return <SchedulingDashboard technicians={technicians} />;
}
