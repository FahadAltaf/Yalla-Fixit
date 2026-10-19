"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import type { CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { Field } from "./enquiry-ui";

/*
  The enquiry's client: one picked from the list (Zoho FSM, as Snagging's
  new quotation), or a new one added with +. The client is the contact.
*/

export type NewClient = {
  kind: "new";
  name: string;
  phone: string;
  email: string;
  maherId: string;
  company: string;
};
export type ChosenClient =
  { kind: "existing"; customer: CustomerRecord } | NewClient;

/** The enquiry's contact is the client. */
export function contactOf(client: ChosenClient): {
  name: string;
  phone: string | null;
  email: string | null;
} {
  if (client.kind === "existing")
    return {
      name: client.customer.name,
      phone: client.customer.phone,
      email: client.customer.email,
    };
  return {
    name: client.name,
    phone: client.phone || null,
    email: client.email || null,
  };
}

/** The chosen client, settled, with a way to choose again. */
export function ChosenClientCard({
  client,
  onChange,
}: {
  client: ChosenClient;
  onChange: () => void;
}) {
  const name = client.kind === "existing" ? client.customer.name : client.name;
  const detail =
    client.kind === "existing"
      ? [
          client.customer.customerRef,
          client.customer.email,
          client.customer.phone,
        ]
          .filter(Boolean)
          .join(" · ") || "No contact details"
      : [client.company, client.email, client.phone]
          .filter(Boolean)
          .join(" · ") || "Saved as a prospect with the enquiry";
  return (
    <div className="border-brand/30 bg-brand-50/50 flex items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5">
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          {client.kind === "new" ? (
            <Badge
              variant="secondary"
              className="h-5 shrink-0 px-1.5 text-[11px] font-medium"
            >
              New prospect
            </Badge>
          ) : null}
        </p>
        <p className="text-muted-foreground truncate text-xs">{detail}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

/**
 * A brand-new client for the enquiry, with the fields Snagging's "Add a
 * client" asks for: name and phone, email, Maher ID (both required when the
 * clients come from Zoho FSM, which needs them) and company. The client is
 * the enquiry's contact. Nothing is saved here: the client is made, as a
 * prospect in the portal, when the enquiry is logged (Zoho FSM is only read
 * for now).
 */
export function NewClientDialog({
  adding,
  onClose,
  onAdd,
}: {
  adding: { typed: string; fromFsm: boolean } | null;
  onClose: () => void;
  onAdd: (client: NewClient) => void;
}) {
  return (
    <Dialog open={adding !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {adding ? (
          <NewClientForm
            typed={adding.typed}
            requireEmail={adding.fromFsm}
            onClose={onClose}
            onAdd={onAdd}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewClientForm({
  typed,
  requireEmail,
  onClose,
  onAdd,
}: {
  typed: string;
  requireEmail: boolean;
  onClose: () => void;
  onAdd: (client: NewClient) => void;
}) {
  const [value, setValue] = useState<NewClient>({
    kind: "new",
    name: typed,
    phone: "",
    email: "",
    maherId: "",
    company: "",
  });
  const patch = (next: Partial<NewClient>) =>
    setValue((v) => ({ ...v, ...next }));
  // As Snagging: name and phone required; email and Maher ID too when FSM keeps the clients.
  const emailOk = /.+@.+\..+/.test(value.email.trim());
  const valid =
    value.name.trim().length >= 2 &&
    /[0-9]{6,}/.test(value.phone.replace(/[^0-9]/g, "")) &&
    (requireEmail
      ? emailOk && value.maherId.trim().length > 0
      : value.email.trim() === "" || emailOk);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a client</DialogTitle>
        <DialogDescription>
          Saved as a prospect when the enquiry is logged, and they are the
          enquiry&apos;s contact.
          {requireEmail
            ? " Zoho FSM needs their email and Maher ID."
            : " Only the name and phone are required."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label="Client name" htmlFor="new-client-name">
          <Input
            id="new-client-name"
            autoFocus
            placeholder="e.g. Ahmed Khan"
            value={value.name}
            onChange={(e) => patch({ name: e.target.value })}
            maxLength={200}
          />
        </Field>
        <Field label="Phone" htmlFor="new-client-phone">
          <PhoneInput
            id="new-client-phone"
            value={value.phone}
            onChange={(phone) => patch({ phone })}
          />
        </Field>
        <Field
          label={requireEmail ? "Email" : "Email (optional)"}
          htmlFor="new-client-email"
        >
          <Input
            id="new-client-email"
            type="email"
            placeholder="name@example.com"
            value={value.email}
            onChange={(e) => patch({ email: e.target.value })}
            maxLength={200}
          />
        </Field>
        {requireEmail ? (
          <Field label="Maher ID" htmlFor="new-client-maher">
            <Input
              id="new-client-maher"
              placeholder="e.g. C0354059"
              value={value.maherId}
              onChange={(e) => patch({ maherId: e.target.value })}
              maxLength={60}
            />
          </Field>
        ) : null}
        <Field label="Company (optional)" htmlFor="new-client-company">
          <Input
            id="new-client-company"
            placeholder="e.g. Driven Properties"
            value={value.company}
            onChange={(e) => patch({ company: e.target.value })}
            maxLength={200}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!valid}
          onClick={() =>
            onAdd({
              ...value,
              name: value.name.trim(),
              email: value.email.trim(),
              maherId: value.maherId.trim(),
              company: value.company.trim(),
            })
          }
        >
          <UserPlus className="size-4" />
          Add client
        </Button>
      </DialogFooter>
    </>
  );
}
