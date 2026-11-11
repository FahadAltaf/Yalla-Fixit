"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ActionDialogContent, ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { amcContractsService, type CustomerInput, type CustomerOverview } from "@/modules/amc-contracts/amc-contracts-service";

import { CustomerDialog } from "./customers-page";

/** The client as the edit form starts from it. */
export function customerInput(c: CustomerOverview["customer"]): CustomerInput {
  return {
    name: c.name,
    customerRef: c.customerRef,
    company: c.company,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    customerType: c.customerType as CustomerInput["customerType"],
    lifecycle: c.lifecycle,
    tradeLicenseNo: c.tradeLicenseNo,
    tradeLicenseExpiry: c.tradeLicenseExpiry,
    trn: c.trn,
    preferredChannel: c.preferredChannel as CustomerInput["preferredChannel"],
    preferredLanguage: c.preferredLanguage,
  };
}

/**
 * "Edit client" from a page that only knows the client's id (an enquiry, a
 * site visit), as the job's Setup tab edits its client in place. Reads the
 * client when opened, then shows the same form as the client's own page.
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
  const [state, setState] = useState<{ customer: CustomerOverview["customer"] } | { error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    amcContractsService.customerRecord(customerId).then(
      ({ customer }) => !stale && setState({ customer }),
      (e) => !stale && setState({ error: e instanceof Error ? e.message : "Could not load the client." }),
    );
    return () => {
      stale = true;
      setState(null);
    };
  }, [open, customerId, attempt]);

  if (open && state && "customer" in state) {
    return (
      <CustomerDialog
        key={`${customerId}-${attempt}`}
        open
        onOpenChange={onOpenChange}
        title="Edit client"
        description="Changes what future documents carry. Signed contracts keep their own copy of these details."
        initial={customerInput(state.customer)}
        onSave={async (input) => {
          await amcContractsService.updateCustomer(customerId, input);
          toast.success("Client saved. Signed contracts are unchanged.");
          onSaved();
        }}
      />
    );
  }

  /* Loading, or the read failed: the same dialog frame, so it does not jump when the form lands. */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={false} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
          <DialogDescription>Changes what future documents carry. Signed contracts keep their own copy of these details.</DialogDescription>
        </DialogHeader>
        {state && "error" in state ? (
          <ErrorState title="Could not load the client" message={state.error} onRetry={() => setAttempt((a) => a + 1)} />
        ) : (
          <div className="grid gap-4 py-2" aria-label="Loading the client">
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          </div>
        )}
      </ActionDialogContent>
    </Dialog>
  );
}
