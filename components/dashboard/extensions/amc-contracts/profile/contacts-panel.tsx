"use client";

import { useState } from "react";
import { Mail, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, UserRound, UserX } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CONTACT_ROLES, CONTACT_ROLE_LABELS } from "@/lib/amc/client-profile";
import { whatsAppLink } from "@/lib/amc/templates";
import { clientProfileService, type ContactInput, type ContactRecord } from "@/modules/amc-contracts/client-profile-service";

import { useAmcData } from "../use-amc-data";

/** A client's contacts (BRD 5.9): as many as needed, each with a role. Deactivated, never deleted. */
export function ContactsPanel({ customerId, canEdit }: { customerId: string; canEdit: boolean }) {
  const { data, error, loading, reload } = useAmcData(() => clientProfileService.contacts(customerId), `contacts|${customerId}`);
  const [editing, setEditing] = useState<ContactRecord | "new" | null>(null);
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

  return (
    <SectionCard
      icon={<UserRound />}
      title="Contacts"
      description="Primary, alternate, accounts, tenant, owner, signatory and on-site contacts."
      bodyClassName="border-t"
      action={
        canEdit && data?.migrated !== false ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
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
        <div className="p-5">
          <EmptyState icon={<UserRound className="size-5" />} title="No contacts yet" description="Add the primary contact first; accounts and tenant contacts can follow." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Contact</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Reach</TableHead>
                <TableHead className="w-12 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.contacts.map((c) => {
                const wa = whatsAppLink(c.whatsapp || c.phone, "");
                return (
                  <TableRow key={c.id} className={c.active ? undefined : "opacity-60"}>
                    <TableCell className="pl-5">
                      <div className="font-medium">{c.name}</div>
                      {c.position ? <div className="text-muted-foreground text-xs">{c.position}</div> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.role === "primary" ? "default" : "secondary"} className="font-normal">
                        {CONTACT_ROLE_LABELS[c.role as keyof typeof CONTACT_ROLE_LABELS] ?? c.role}
                      </Badge>
                      {!c.active ? <span className="text-muted-foreground ml-2 text-xs">Inactive</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {c.phone ? (
                          <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:underline">
                            <Phone className="size-3.5" />
                            {c.phone}
                          </a>
                        ) : null}
                        {wa ? (
                          <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                            <MessageCircle className="size-3.5" />
                            WhatsApp
                          </a>
                        ) : null}
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:underline">
                            <Mail className="size-3.5" />
                            {c.email}
                          </a>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="pr-5">
                      {canEdit ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${c.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(c)}>
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                            {c.active ? (
                              <DropdownMenuItem onClick={() => void deactivate(c)}>
                                <UserX className="size-4" />
                                Deactivate
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <ContactDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await clientProfileService.addContact(customerId, input);
            else await clientProfileService.updateContact(customerId, editing.id, { ...input, active: editing.active });
            toast.success("Contact saved");
            setEditing(null);
            reload();
          }}
        />
      ) : null}
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
  initial,
  onClose,
  onSave,
}: {
  initial: ContactRecord | null;
  onClose: () => void;
  onSave: (input: ContactInput) => Promise<void>;
}) {
  const [value, setValue] = useState<ContactInput>(initial ? toInput(initial) : { role: "primary", name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ContactInput) => (e: { target: { value: string } }) => setValue((v) => ({ ...v, [k]: e.target.value }));
  const nul = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...value, name: value.name.trim(), position: nul(value.position), phone: nul(value.phone), whatsapp: nul(value.whatsapp), email: nul(value.email), notes: nul(value.notes) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>At least a phone, WhatsApp number or email.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ct-name">Name</Label>
            <Input id="ct-name" value={value.name} onChange={set("name")} maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Select value={value.role} onValueChange={(role) => setValue((v) => ({ ...v, role }))}>
              <SelectTrigger aria-label="Role">
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
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !value.name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
