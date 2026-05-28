import type { Metadata } from "next";
import TodosPage from "@/components/dashboard/todos";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Todos | Work Management";
const description = "Create, assign, track, and follow up on portal todos.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: `${baseUrl}/todos`,
  },
  openGraph: {
    title,
    description,
    url: `${baseUrl}/todos`,
  },
};

export default function Page() {
  return <TodosPage />;
}
