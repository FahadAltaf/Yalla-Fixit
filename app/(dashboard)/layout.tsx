import CheckUserRole from "@/components/auth/check-user-role";
import DashboardLayout from "@/components/dashboard-layout";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CheckUserRole>
      <DashboardLayout>{children}</DashboardLayout>
    </CheckUserRole>
  );
}
