"use client";

import { Building2, Mail, Phone, UserRound } from "lucide-react";

import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SnaggingClientOption } from "@/modules/snagging";

/**
 * Add client found the email already in Zoho FSM, which keeps one contact
 * per email: no second client was made, and the existing one was opened.
 * Said in a popup with that client's details (UAT retest, point 1), not a
 * toast in the corner that is gone before it is read.
 *
 * `action` is what the caller offers next: open their addresses on the
 * Clients page, or carry on with them on a quotation.
 */
export function ExistingClientDialog({
  client,
  onClose,
  action,
}: {
  client: SnaggingClientOption | null;
  onClose: () => void;
  action?: { label: string; onClick: (client: SnaggingClientOption) => void };
}) {
  const rows = client
    ? [
        { icon: UserRound, value: client.client_name },
        { icon: Mail, value: client.client_email },
        { icon: Phone, value: client.client_phone },
        { icon: Building2, value: client.company },
      ].filter((row) => row.value)
    : [];
  return (
    <Dialog open={client !== null} onOpenChange={(open) => !open && onClose()}>
      <ActionDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{client?.client_name ?? "This client"} is already a client</DialogTitle>
          <DialogDescription>
            Zoho FSM already has {client?.client_email ?? "this email"} on file, and keeps one client per email, so no
            second client was added. This is the client on file:
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {rows.map(({ icon: Icon, value }) => (
            <li key={String(value)} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{value}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          If this is a different person, add them with an email of their own.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {action ? "Close" : "OK"}
          </Button>
          {action && client ? (
            <Button
              onClick={() => {
                onClose();
                action.onClick(client);
              }}
            >
              {action.label}
            </Button>
          ) : null}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
