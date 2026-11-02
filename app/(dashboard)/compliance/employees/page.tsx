import { redirect } from "next/navigation";

// The Employees list moved to Workforce → People (C6). Its filters travel
// with it, so the Overview cards still land on the same people.
export default async function ComplianceEmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = params.toString();
  redirect(query ? `/workforce?${query}` : "/workforce");
}
