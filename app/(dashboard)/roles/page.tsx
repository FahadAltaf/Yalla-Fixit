import type { Metadata } from "next";
import RoleManagementPage from "@/components/dashboard/roles";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Roles | Access Management";
const description =
  "Define and manage user roles and their permissions in the Kaizen yallafixit dashboard.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: `${baseUrl}/roles`,
  },
  openGraph: {
    title,
    description,
    url: `${baseUrl}/roles`,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RolesPage() {
  return <RoleManagementPage type="roles" />;
}
