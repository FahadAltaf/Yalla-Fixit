"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ActionDialogContent, ErrorState, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import DateSelect from "@/components/ui/date-select";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABELS, LIFECYCLE_LABELS, PREFERRED_CHANNELS } from "@/lib/amc/client-profile";
import { contactProblem, isEmail } from "@/lib/clients/client-input";
import { CLIENT_PHONE_REQUIRED, isUsablePhone } from "@/lib/snagging/client-phone";
import { clientsService, type ClientAmcFields, type ClientContactInput, type ClientForEdit } from "@/modules/clients/clients-service";

const BLANK: ClientContactInput = { name: "", email: null, phone: null, company: null, maherId: null, notes: null };

/**
 * Add client and Edit client: the one form for every client in the portal
 * (26 Nov 2026, the user: one Clients module, not AMC's and Snagging's).
 *
 * The contact details are saved to Zoho FSM and the portal, so FSM's
 * required email is required whenever the client is kept there; the Maher ID
 * is optional (26 Nov 2026). AMC's own fields (Customer ID, type, status, licence, preferences)
 * show for someone who may change them.
 *
 * Opened with a client id it edits that client, read when opened; with
 * none it adds one. Always mounted; give it a fresh `key` per open.
 */
export function ClientDialog({
  open,
  onOpenChange,
  clientId,
  writesToFsm = true,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client to edit; null adds one. */
  clientId: string | null;
  /** Adding: whether the new client goes to Zoho FSM (the list says). */
  writesToFsm?: boolean;
  /** After a save: the client, and whether Zoho FSM already had them (adding). */
  onSaved: (client: { id: string; name: string; existed?: boolean }) => void;
}) {
  const creating = clientId === null;
  const [loaded, setLoaded] = useState<ClientForEdit | { error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [contact, setContact] = useState<ClientContactInput>(BLANK);
  const [amc, setAmc] = useState<ClientAmcFields | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || creating) return;
    let stale = false;
    clientsService.get(clientId).then(
      (result) => {
        if (stale) return;
        setLoaded(result);
        const c = result.client;
        setContact({ name: c.name, email: c.email, phone: c.phone, company: c.company, maherId: c.maherId, notes: c.notes });
        setAmc(result.canEditAmc ? c.amc : null);
      },
      (e) => !stale && setLoaded({ error: e instanceof Error ? e.message : "Could not load the client." }),
    );
    return () => {
      stale = true;
    };
  }, [open, creating, clientId, attempt]);

  const record = loaded && "client" in loaded ? loaded : null;
  const savedInFsm = creating ? writesToFsm : Boolean(record?.savedInFsm);
  const readOnly = !creating && record !== null && !record.canEditContact;
  const ready = creating || record !== null;
  const problem = contactProblem(contact, { savedInFsm });
  const set = (key: keyof ClientContactInput) => (value: string) => {
    setTouched(true);
    setContact((c) => ({ ...c, [key]: value.trim() ? value : null }));
  };
  const setAmcField = <K extends keyof ClientAmcFields>(key: K, value: ClientAmcFields[K]) => setAmc((a) => (a ? { ...a, [key]: value } : a));

  async function save() {
    if (problem || saving) return;
    setSaving(true);
    const input: ClientContactInput = {
      name: contact.name.trim(),
      email: contact.email?.trim() || null,
      phone: contact.phone?.trim() || null,
      company: contact.company?.trim() || null,
      maherId: contact.maherId?.trim() || null,
      notes: contact.notes?.trim() || null,
    };
    try {
      if (creating) {
        const { client, existed } = await clientsService.create(input);
        onOpenChange(false);
        onSaved({ ...client, existed });
        return;
      }
      const { client } = await clientsService.update(clientId, { ...input, amc: amc ?? undefined });
      toast.success("Client saved", {
        description: savedInFsm ? "Saved in Zoho FSM and the portal. Signed contracts and issued quotations keep their own copy." : "Signed contracts and issued quotations keep their own copy.",
      });
      onOpenChange(false);
      onSaved({ id: client.id, name: client.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the client.");
    } finally {
      setSaving(false);
    }
  }

  const showError = (field: "name" | "phone" | "email"): string | undefined => {
    if (!touched && creating) return undefined;
    if (field === "name") return contact.name.trim().length > 0 && contact.name.trim().length < 2 ? "A name needs at least two characters." : !contact.name.trim() ? "Enter the client's name." : undefined;
    if (field === "phone") return !isUsablePhone(contact.phone) ? (contact.phone ? "Enter the full number, with at least six digits." : CLIENT_PHONE_REQUIRED) : undefined;
    if (field === "email") return contact.email && !isEmail(contact.email) ? "Enter a full email address." : savedInFsm && !contact.email ? "Zoho FSM requires an email." : undefined;
    return undefined;
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <ActionDialogContent busy={saving} className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{creating ? "Add a client" : record ? `Edit ${record.client.name}` : "Edit client"}</DialogTitle>
          <DialogDescription>
            {creating
              ? savedInFsm
                ? "Name, phone and email are required. The client is created in Zoho FSM as well."
                : "Name and phone are required; the rest can be added later."
              : savedInFsm
                ? "Saved in Zoho FSM and the portal, for AMC and Snagging alike. Signed contracts and issued quotations keep their own copy."
                : "Saved for AMC and Snagging alike. Signed contracts and issued quotations keep their own copy."}
          </DialogDescription>
        </DialogHeader>

        {loaded && "error" in loaded ? (
          <ErrorState title="Could not load the client" message={loaded.error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : !ready ? (
          <div className="grid gap-4 py-2">
            <Skeleton className="h-9 w-full" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : readOnly ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            You can see this client but not change it. Ask someone with Clients (Edit) in Snagging, or the person who added them in AMC.
          </p>
        ) : (
          <div className="grid gap-4 py-1">
            <Field label="Name" htmlFor="client-name" required error={showError("name")}>
              <Input id="client-name" value={contact.name} onChange={(e) => set("name")(e.target.value)} placeholder="Who the work is for" maxLength={200} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" htmlFor="client-phone" required error={showError("phone")}>
                <PhoneInput id="client-phone" value={contact.phone ?? ""} onChange={set("phone")} />
              </Field>
              <Field label="Email" htmlFor="client-email" required={savedInFsm} error={showError("email")}>
                <Input id="client-email" type="email" value={contact.email ?? ""} onChange={(e) => set("email")(e.target.value)} placeholder="name@company.com" maxLength={200} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Maher ID (optional)" htmlFor="client-maher-id">
                <Input id="client-maher-id" value={contact.maherId ?? ""} onChange={(e) => set("maherId")(e.target.value)} placeholder="e.g. C0354059" maxLength={60} />
              </Field>
              <Field label="Company" htmlFor="client-company">
                <Input id="client-company" value={contact.company ?? ""} onChange={(e) => set("company")(e.target.value)} placeholder="Agency or developer, if any" maxLength={200} />
              </Field>
            </div>
            {!creating ? (
              <Field label="Notes" htmlFor="client-notes">
                <Textarea id="client-notes" rows={2} value={contact.notes ?? ""} onChange={(e) => set("notes")(e.target.value)} placeholder="Anything the team should know before calling…" maxLength={2000} />
              </Field>
            ) : null}

            {amc ? (
              <div className="grid gap-4 border-t pt-4">
                <div>
                  <p className="text-sm font-medium">AMC details</p>
                  <p className="text-muted-foreground text-xs">Kept by AMC only; not sent to Zoho FSM.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Customer ID" htmlFor="client-ref">
                    <Input id="client-ref" value={amc.customerRef ?? ""} onChange={(e) => setAmcField("customerRef", e.target.value || null)} placeholder="e.g. YFI1806" maxLength={60} />
                  </Field>
                  <Field label="Status" htmlFor="client-lifecycle">
                    <Select value={amc.lifecycle} onValueChange={(v) => setAmcField("lifecycle", v as ClientAmcFields["lifecycle"])}>
                      <SelectTrigger id="client-lifecycle" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(LIFECYCLE_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Type" htmlFor="client-type">
                    <Select value={amc.customerType ?? ""} onValueChange={(v) => setAmcField("customerType", v || null)}>
                      <SelectTrigger id="client-type" className="w-full">
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="individual">Individual</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Preferred channel" htmlFor="client-channel">
                    <Select value={amc.preferredChannel ?? ""} onValueChange={(v) => setAmcField("preferredChannel", v || null)}>
                      <SelectTrigger id="client-channel" className="w-full">
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {PREFERRED_CHANNELS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CHANNEL_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Preferred language" htmlFor="client-language">
                    <Input id="client-language" value={amc.preferredLanguage ?? ""} onChange={(e) => setAmcField("preferredLanguage", e.target.value || null)} placeholder="e.g. English, Arabic" maxLength={40} />
                  </Field>
                  {amc.customerType === "company" ? (
                    <>
                      <Field label="Trade licence no." htmlFor="client-licence">
                        <Input id="client-licence" value={amc.tradeLicenseNo ?? ""} onChange={(e) => setAmcField("tradeLicenseNo", e.target.value || null)} maxLength={60} />
                      </Field>
                      <Field label="Licence expiry" htmlFor="client-licence-expiry">
                        <DateSelect id="client-licence-expiry" value={amc.tradeLicenseExpiry ?? ""} onChange={(day) => setAmcField("tradeLicenseExpiry", day || null)} />
                      </Field>
                      <Field label="TRN (15 digits)" htmlFor="client-trn">
                        <Input id="client-trn" inputMode="numeric" value={amc.trn ?? ""} onChange={(e) => setAmcField("trn", e.target.value || null)} maxLength={15} />
                      </Field>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {readOnly || (loaded && "error" in loaded) ? null : (
            <SubmitButton onClick={() => void save()} pending={saving} pendingLabel="Saving…" disabled={!ready || Boolean(problem)}>
              {creating ? "Add client" : "Save changes"}
            </SubmitButton>
          )}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Field({ label, htmlFor, error, required, children }: { label: string; htmlFor: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-medium">
        {label}
        {required ? <span className="text-brand"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
