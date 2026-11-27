"use client";

import { TriangleAlert } from "lucide-react";

/**
 * Zoho FSM creates a company only with a Maher ID (27 Nov 2026: it refused
 * "Test Company QA" without one, while a client on their own needs none).
 * Shown under a client form's Company field, before it is saved, whenever a
 * company is typed and the Maher ID is empty. Every form that adds or edits
 * a client uses it: Clients (Add / Edit client), a new enquiry, a new
 * Snagging job.
 */
export function CompanyMaherNotice({ company, maherId }: { company: string | null | undefined; maherId: string | null | undefined }) {
  const name = company?.trim();
  if (!name || maherId?.trim()) return null;
  return (
    <p role="status" className="border-warning/30 bg-warning/10 text-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-sm sm:col-span-2">
      <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        A Maher ID is required for the company. Without it, Zoho FSM will not create the company &ldquo;{name}&rdquo;. Add the Maher ID, or leave Company empty.
      </span>
    </p>
  );
}
