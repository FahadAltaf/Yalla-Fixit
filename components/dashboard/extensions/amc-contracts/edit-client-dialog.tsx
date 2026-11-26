"use client";

import { ClientDialog } from "@/components/dashboard/clients/client-dialog";

/**
 * "Edit client" from a page that only knows the client's id (an enquiry, a
 * site visit, a proposal). Since 26 Nov 2026 it is the Clients module's one
 * Edit client: the contact details go to Zoho FSM and the portal, and AMC's
 * own fields show for someone who may change them.
 */
export function EditClientDialog({
  open,
  onOpenChange,
  customerId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  onSaved: () => void;
}) {
  if (!open) return null;
  return <ClientDialog key={customerId} open onOpenChange={onOpenChange} clientId={customerId} onSaved={onSaved} />;
}
