import type { Metadata } from "next";
import { listTechnicians } from "@/modules/scheduling";
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
  const technicians = await listTechnicians();

  return <DailyScheduleDashboard technicians={technicians} />;
}
