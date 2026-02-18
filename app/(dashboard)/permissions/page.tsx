import type { Metadata } from "next";
import PermissionManagementPage from "@/components/dashboard/permissions";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Permissions | Access Control";
const description =
  "Manage fine-grained permissions and resource access policies for dashboard users.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: `${baseUrl}/permissions`,
  },
  openGraph: {
    title,
    description,
    url: `${baseUrl}/permissions`,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function PermissionsPage() {
  return <PermissionManagementPage />;
}
