"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { EmployeeForm } from "./employee-form";

export default function NewEmployee() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Manpower compliance"
        title="New employee"
        description="Create the compliance record. Statuses are calculated from the expiry dates."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/workforce">
              <ArrowLeft className="size-4" /> Employees
            </Link>
          </Button>
        }
      />
      <EmployeeForm record={null} onSaved={(saved) => router.push(`/workforce/${saved.id}`)} />
    </div>
  );
}
