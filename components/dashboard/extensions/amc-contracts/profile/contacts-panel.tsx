"use client";

import { useState } from "react";
import { EllipsisVerticalIcon, Mail, MessageCircle, Pencil, Phone, Plus, UserRound, UserX } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CONTACT_ROLES, CONTACT_ROLE_LABELS } from "@/lib/amc/client-profile";
import { whatsAppLink } from "@/lib/amc/templates";
import { clientProfileService, type ContactInput, type ContactRecord } from "@/modules/amc-contracts/client-profile-service";

import { useAmcData } from "../use-amc-data";
import { useDialog } from "./use-dialog";

/** A client's contacts (BRD 5.9): as many as needed, each with a role. Deactivated, never deleted. */
export function ContactsPanel({ customerId, canEdit }: { customerId: string; canEdit: boolean }) {
  const { data, error, loading, reload } = useAmcData(() => clientProfileService.contacts(customerId), `contacts|${customerId}`);
  const editing = useDialog<ContactRecord | "new">();
  const { confirm, dialog } = useConfirm();

  const deactivate = async (c: ContactRecord) => {
    const ok = await confirm({
      title: `Deactivate ${c.name}?`,
      description: "The contact stays on record but is no longer offered for messages and documents.",
      confirmText: "Deactivate",
      variant: "destructive",
      action: () => clientProfileService.updateContact(customerId, c.id, { ...toInput(c), active: false }),
    });
    if (ok) {
      toast.success("Contact deactivated");
      reload();
    }
  };

  const target = editing.target;

  return (
    <SectionCard
      icon={<UserRound />}
      title="Contacts"
      description="Primary, alternate, accounts, tenant, owner, signatory and on-site contacts."
      bodyClassName="border-t"
      action={
        canEdit && data?.migrated !== false ? (
          <Button size="sm" variant="outline" onClick={() => editing.show("new")}>
            <Plus className="size-4" />
            Add contact
          </Button>
        ) : null
      }
    >
      {dialog}
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the contacts" message={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <ListSkeleton rows={3} />
      ) : data?.migrated === false ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">Contacts arrive with the Phase 2 database update (20261007120000).</p>
      ) : (data?.contacts.length ?? 0) === 0 ? (
        <EmptyState
          icon={<UserRound className="size-5" />}
          title="No contacts yet"
          description="Add the primary contact first; accounts and tenant contacts can follow."
          action={canEdit ? { label: "Add contact", onClick: () => editing.show("new") } : undefined}
        />
      ) : (
        <ul className="divide-y">
          {data!.contacts.map((c) => {
            const wa = whatsAppLink(c.whatsapp || c.phone, "");
            return (
              <li key={c.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 ${c.active ? "" : "opacity-60"}`}>
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                    <UserRound className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <Badge variant="secondary" className={`border-0 font-medium ${c.role === "primary" ? "bg-brand-50 text-brand" : "bg-mist text-ink-soft"}`}>
                        {CONTACT_ROLE_LABELS[c.role as keyof typeof CONTACT_ROLE_LABELS] ?? c.role}
                      </Badge>
                      {!c.active ? <span className="text-muted-foreground text-xs">Inactive</span> : null}
                    </div>
                    {c.position ? <div className="text-muted-foreground truncate text-xs">{c.position}</div> : null}
                  </div>
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="hover:text-foreground inline-flex items-center gap-1.5">
                      <Phone className="size-3.5" aria-hidden />
                      {c.phone}
                    </a>
                  ) : null}
                  {wa ? (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="hover:text-foreground inline-flex items-center gap-1.5">
                      <MessageCircle className="size-3.5" aria-hidden />
                      WhatsApp
                    </a>
                  ) : null}
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="hover:text-foreground inline-flex items-center gap-1.5">
                      <Mail className="size-3.5" aria-hidden />
                      {c.email}
                    </a>
                  ) : null}
                </div>
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <EllipsisVerticalIcon className="size-4" />
                        <span className="sr-only">Actions for {c.name}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => editing.show(c)}>
                        <Pencil className="size-4" />
                        Edit
                      </DropdownMenuItem>
                      {c.active ? (
                        <DropdownMenuItem onClick={() => void deactivate(c)} className="text-destructive focus:text-destructive">
                          <UserX className="size-4" />
                          Deactivate
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ContactDialog
        key={editing.key}
        open={editing.open}
        onOpenChange={editing.onOpenChange}
        initial={target === "new" ? null : target}
        onSave={async (input) => {
          if (!target || target === "new") await clientProfileService.addContact(customerId, input);
          else await clientProfileService.updateContact(customerId, target.id, { ...input, active: target.active });
          toast.success("Contact saved");
          reload();
        }}
      />
    </SectionCard>
  );
}

const toInput = (c: ContactRecord): ContactInput => ({
  role: c.role,
  name: c.name,
  position: c.position,
  phone: c.phone,
  whatsapp: c.whatsapp,
  email: c.email,
  notes: c.notes,
});

function ContactDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ContactRecord | null;
  onSave: (input: ContactInput) => Promise<void>;
}) {
  const [value, setValue] = useState<ContactInput>(initial ? toInput(initial) : { role: "primary", name: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ContactInput) => (e: { target: { value: string } }) => setValue((v) => ({ ...v, [k]: e.target.value }));
  const nul = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ ...value, name: value.name.trim(), position: nul(value.position), phone: nul(value.phone), whatsapp: nul(value.whatsapp), email: nul(value.email), notes: nul(value.notes) });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the contact.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>Saves a contact on this client. Give at least a phone, WhatsApp number or email.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ct-name">Name</Label>
            <Input id="ct-name" value={value.name} onChange={set("name")} maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Select value={value.role} onValueChange={(role) => setValue((v) => ({ ...v, role }))}>
              <SelectTrigger aria-label="Role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {CONTACT_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ct-position">Position (optional)</Label>
            <Input id="ct-position" value={value.position ?? ""} onChange={set("position")} maxLength={120} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ct-phone">Phone</Label>
            <Input id="ct-phone" value={value.phone ?? ""} onChange={set("phone")} maxLength={40} placeholder="05x xxx xxxx" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ct-wa">WhatsApp (if different)</Label>
            <Input id="ct-wa" value={value.whatsapp ?? ""} onChange={set("whatsapp")} maxLength={40} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ct-email">Email</Label>
            <Input id="ct-email" type="email" value={value.email ?? ""} onChange={set("email")} maxLength={200} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ct-notes">Notes (optional)</Label>
            <Textarea id="ct-notes" rows={2} value={value.notes ?? ""} onChange={set("notes")} maxLength={1000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…" disabled={!value.name.trim()}>
            {initial ? "Save changes" : "Add contact"}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
