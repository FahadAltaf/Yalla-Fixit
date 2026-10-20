"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { SnaggingClientsToolbar } from "@/components/data-table/toolbars/snagging-clients-toolbar";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { PhoneInput } from "@/components/ui/phone-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Hint } from "@/components/ui/hint";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { CLIENT_PHONE_REQUIRED, isUsablePhone } from "@/lib/snagging/client-phone";
import {
  snaggingService,
  type SnaggingClientOption,
} from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import { ClientAddressesDialog } from "./client-addresses-dialog";
import { ClientJobsDialog } from "./client-jobs-dialog";
import { ExistingClientDialog } from "./existing-client-dialog";
import {
  ActionDialogContent,
  ErrorState,
  PageHeading,
  SubmitButton,
} from "./shared";


/**
 * The Clients page (BA v2, change 8 / FR-1.11).
 *
 * A client could be created inside the job wizard and never touched again.
 * There was no screen that listed them and no way to correct one, so a
 * phone number typed wrong at 8am stayed wrong on every quotation and every
 * job that client ever had — and the only workaround was a second client
 * record with the same name, which is how a contact list rots.
 *
 * Deliberately a table of contact details rather than a CRM: the team's
 * question is "who is this and how do I reach them", and the answer is one
 * row. Job count earns its column by being the one thing that says which
 * of two similarly-named records is the real one.
 */
export default function ClientsAdmin({
  initial,
}: {
  /*
    The first page, read on the server with the page (see
    app/(dashboard)/snagging/clients/page.tsx). The table shows it at once;
    every later page, sort and search is asked for as before.
  */
  initial?: { data: SnaggingClientOption[]; hasMore: boolean; source: "fsm" | "portal" } | null;
} = {}) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EDIT,
  );
  const canCreate = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.CREATE,
  );

  const [clients, setClients] = useState<SnaggingClientOption[]>(initial?.data ?? []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  /*
    Clients are kept in Zoho FSM (Sami, 14 Oct 2026) and listed from it,
    newest first. FSM gives no total, so the table pages on "is there
    another page" rather than "page 3 of 529".
  */
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? false);
  const [source, setSource] = useState<"fsm" | "portal">(initial?.source ?? "fsm");
  // The FSM contact being linked to the portal before its addresses open.
  const [opening, setOpening] = useState<string | null>(null);
  // The client whose jobs are open in a popup.
  const [jobsFor, setJobsFor] = useState<SnaggingClientOption | null>(null);
  // The client whose addresses are open in a popup.
  const [addressesFor, setAddressesFor] = useState<SnaggingClientOption | null>(null);
  /* Add client found the email already in FSM: said in a popup, with that client. */
  const [existingClient, setExistingClient] = useState<SnaggingClientOption | null>(null);
  const [editing, setEditing] = useState<SnaggingClientOption | null>(null);
  /** Distinguishes "add a client" from "edit this one" in the same dialog. */
  const [creating, setCreating] = useState(false);
  // Searched on the server, a moment after typing stops.
  const debouncedSearch = useDebounce(search.trim(), 300);

  /* Only the latest request may fill the table: a slower reply for an
     earlier filter or page used to land last and show the wrong rows. */
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await snaggingService.listFsmClients({
        search: debouncedSearch || undefined,
        page,
        pageSize,
      });
      if (mine !== ticket.current) return;
      setClients(result.data);
      setHasMore(result.hasMore);
      setSource(result.source);
    } catch (err) {
      if (mine !== ticket.current) return;
      setError(err instanceof Error ? err.message : "Could not load clients");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [debouncedSearch, page, pageSize]);

  /*
    A client listed from FSM has no portal row until it is used. Its
    addresses (and their documents) live on that row, so it is made here,
    the first time they are opened.
  */
  const openAddresses = useCallback(async (client: SnaggingClientOption) => {
    if (client.id) {
      setAddressesFor(client);
      return;
    }
    if (!client.fsm_contact_id) return;
    setOpening(client.fsm_contact_id);
    try {
      const linked = await snaggingService.linkFsmClient(client.fsm_contact_id);
      setClients((rows) =>
        rows.map((row) => (row.fsm_contact_id === client.fsm_contact_id ? { ...row, ...linked } : row)),
      );
      setAddressesFor(linked);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open this client");
    } finally {
      setOpening(null);
    }
  }, []);

  // The first request is skipped when the server already sent the first page.
  const skipFirstLoad = useRef(Boolean(initial));
  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
      return;
    }
    void load();
  }, [load]);

  /*
    Paged and searched on the server. The list used to arrive whole and
    be filtered here, which quietly stopped at the first 400 clients:
    anyone after that could not be found at all.
  */

  const columns = useMemo<ColumnDef<SnaggingClientOption>[]>(
    () => [
      {
        id: "client_name",
        header: "Client",
        accessorKey: "client_name",
        // Newest first, as FSM lists them: FSM cannot sort by these columns.
        enableSorting: false,
        cell: ({ row }) => (
          /*
            The shared identity cell, not a hand-rolled avatar. It hashes
            the colour off a stable seed, so a client keeps the same colour
            on every screen — which a locally built AvatarFallback did not,
            giving every row the same grey circle.
          */
          <IdentityCell
            title={row.original.client_name}
            subtitle={
              [row.original.company || "No company recorded", row.original.maher_id ? `Maher ID ${row.original.maher_id}` : null]
                .filter(Boolean)
                .join(" · ")
            }
            seed={row.original.fsm_contact_id ?? row.original.id ?? row.original.client_name}
          />
        ),
      },
      {
        id: "client_phone",
        header: "Phone",
        accessorKey: "client_phone",
        enableSorting: false,
        cell: ({ row }) => (
          <Contact icon={Phone} value={row.original.client_phone} />
        ),
      },
      {
        id: "client_email",
        header: "Email",
        accessorKey: "client_email",
        enableSorting: false,
        cell: ({ row }) => (
          <Contact icon={Mail} value={row.original.client_email} />
        ),
      },
      {
        id: "property_count",
        header: "Addresses",
        accessorKey: "property_count",
        // Counted per page on the server, like the jobs beside it.
        enableSorting: false,
        /*
          Where the client's units are kept. There was nowhere to see or
          add one: an address only existed as a side effect of a quotation,
          so a returning client's was typed in again each time.
        */
        cell: ({ row }) => {
          /*
            The count is the portal's own rows. A client from FSM can have
            addresses there the portal has not used yet, so an FSM client
            shows "Addresses" and the popup lists both.
          */
          const fromFsm = Boolean(row.original.fsm_contact_id);
          const count = row.original.property_count ?? 0;
          if (!fromFsm && count === 0 && !canCreate) {
            return <span className="text-muted-foreground text-sm">None yet</span>;
          }
          const busy = opening !== null && opening === row.original.fsm_contact_id;
          return (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void openAddresses(row.original);
              }}
              aria-label={`Addresses for ${row.original.client_name}`}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <MapPin className="size-3.5" aria-hidden />
              )}
              {fromFsm ? "Addresses" : count === 0 ? "Add address" : `Addresses (${count})`}
            </Button>
          );
        },
      },
      {
        id: "job_count",
        header: "Jobs",
        accessorKey: "job_count",
        // Counted per page on the server, so it cannot be sorted across
        // every client. The button opens the client's jobs, the same way
        // "View defects" opens a developer's defects on Analytics.
        enableSorting: false,
        cell: ({ row }) => {
          const count = row.original.job_count ?? 0;
          if (count === 0) {
            return <span className="text-muted-foreground text-sm">None yet</span>;
          }
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                setJobsFor(row.original);
              }}
              aria-label={`View ${count} jobs for ${row.original.client_name}`}
            >
              <Briefcase className="size-3.5" aria-hidden />
              View jobs ({count})
            </Button>
          );
        },
      },
      {
        id: "actions",
        header: () => "Actions",
        enableHiding: false,
        enableSorting: false,
        // One action, so one icon rather than a menu holding it.
        cell: ({ row }) =>
          canEdit ? (
            <Hint label="Edit details">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={(event) => {
                  event.stopPropagation();
                  setCreating(false);
                  setEditing(row.original);
                }}
                aria-label={`Edit ${row.original.client_name}`}
              >
                <Pencil className="size-4" />
              </Button>
            </Hint>
          ) : null,
      },
    ],
    [canEdit, canCreate, opening, openAddresses],
  );

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          eyebrow="Master data"
          title="Clients"
          description="Who jobs and quotations are raised for."
        />
        <ErrorState
          title="Could not load clients"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
        <PageHeading
          eyebrow="Master data"
          title="Clients"
          description={
            source === "fsm"
              ? "Clients and their addresses are kept in Zoho FSM. New clients and edits made here are saved there too."
              : "Who jobs and quotations are raised for. Edits here reach every future document."
          }
          actions={
            canCreate ? (
              <Button
                onClick={() => {
                  setCreating(true);
                  setEditing({ client_name: "", client_email: null, client_phone: null });
                }}
              >
                <Plus className="size-4" />
                Add client
              </Button>
            ) : null
          }
        />


      <Card className="py-0">
        <DataTable
          columns={columns}
          data={clients}
          loading={loading}
          rowCount={0}
          hasMore={hasMore}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          onGlobalFilterChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          toolbar={
            <SnaggingClientsToolbar
              fetchRecords={() => void load()}
              globalFilter={search}
              onGlobalFilterChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              isSearchLoading={loading}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              canCreate={canCreate}
              onCreate={() => {
                setCreating(true);
                setEditing({
                  client_name: "",
                  client_email: null,
                  client_phone: null,
                });
              }}
            />
          }
          emptyState={
            <EmptyState
              icon={<Users className="size-5" />}
              title={
                search.trim()
                  ? "No client matches that"
                  : "No clients yet"
              }
              description={
                search.trim()
                  ? source === "fsm"
                    ? "Zoho FSM searches the last name, the email and the phone number. Try one of those."
                    : "Try a partial phone number, or part of the company name."
                  : "Clients are created with their first job, and appear here once they are."
              }
            />
          }
        />
      </Card>

      <ClientDialog
        client={editing}
        creating={creating}
        requireEmail={source === "fsm"}
        onClose={() => setEditing(null)}
        onSaved={(created) => {
          setEditing(null);
          void load();
          /*
            FSM already had the email: nothing new was made, and the dialog
            used to close without a word (UAT retest, point 1). Say which
            client it is, and open their addresses.
          */
          if (created?.existed) {
            setExistingClient(created);
            return;
          }
          // A new client has no address yet; offer it while they are in mind.
          if (created?.id) {
            toast.success("Client added", {
              description: "Add their address so it fills in on their quotations.",
              action: { label: "Add address", onClick: () => setAddressesFor(created) },
            });
          }
        }}
      />

      <ExistingClientDialog
        client={existingClient}
        onClose={() => setExistingClient(null)}
        action={{ label: "Open addresses", onClick: (client) => setAddressesFor(client) }}
      />

      <ClientJobsDialog client={jobsFor} onClose={() => setJobsFor(null)} />

      <ClientAddressesDialog
        client={addressesFor}
        canEdit={canCreate || canEdit}
        onClose={() => setAddressesFor(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}

/** A contact line, or an honest blank where there is nothing to call. */
function Contact({
  icon: Icon,
  value,
}: {
  icon: typeof Phone;
  value?: string | null;
}) {
  if (!value) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">{value}</span>
    </span>
  );
}

/**
 * Add or correct one client.
 *
 * The same form does both, because the fields are the same and the team
 * should not have to learn two dialogs. What differs is the warning: an
 * edit reaches every future job and quotation this client is on, and
 * saying so is the difference between a confident correction and a
 * nervous one.
 */
function ClientDialog({
  client,
  creating,
  requireEmail,
  onClose,
  onSaved,
}: {
  client: SnaggingClientOption | null;
  creating: boolean;
  /** Zoho FSM keeps every client with an email, so a new one needs one. */
  requireEmail: boolean;
  onClose: () => void;
  /** Passed the new client when one was added, nothing on an edit. */
  onSaved: (created?: SnaggingClientOption) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [maherId, setMaherId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(client?.client_name ?? "");
    setEmail(client?.client_email ?? "");
    setPhone(client?.client_phone ?? "");
    setCompany(client?.company ?? "");
    setMaherId(client?.maher_id ?? "");
    setNotes(client?.notes ?? "");
  }, [client]);

  const nameError = name.trim().length > 0 && name.trim().length < 2;
  // Required here as on the quotation form (SNG-008). Said once something
  // has been typed, so an empty new dialog does not open on an error.
  const phoneError = phone.trim().length > 0 && !isUsablePhone(phone);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Said once something has been typed, like the phone above.
  const emailError =
    email.trim().length > 0 && !emailValid ? "Enter a full email address." : undefined;
  const canSave =
    name.trim().length >= 2 &&
    isUsablePhone(phone) &&
    (!requireEmail || emailValid) &&
    // Zoho FSM requires it, so it can be neither left out nor cleared.
    (!requireEmail || maherId.trim().length > 0) &&
    (!email.trim() || emailValid) &&
    !saving;

  async function save() {
    if (!client || !canSave) return;
    setSaving(true);
    try {
      if (creating) {
        const created = await snaggingService.createClient({
          client_name: name.trim(),
          client_email: email.trim() || undefined,
          client_phone: phone.trim() || undefined,
          company: company.trim() || undefined,
          maher_id: maherId.trim() || undefined,
        });
        // The page announces it, with the offer to add an address.
        onSaved(created);
        return;
      } else {
        await snaggingService.updateClient({
          ...(client.id ? { id: client.id } : { fsm_contact_id: client.fsm_contact_id ?? null }),
          client_name: name.trim(),
          client_email: email.trim() || null,
          client_phone: phone.trim() || null,
          company: company.trim() || null,
          ...(maherId.trim() ? { maher_id: maherId.trim() } : {}),
          notes: notes.trim() || null,
        });
        toast.success("Client updated");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the client");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(client)} onOpenChange={(open) => !open && onClose()}>
      <ActionDialogContent busy={saving} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {creating ? "Add a client" : `Edit ${client?.client_name}`}
          </DialogTitle>
          <DialogDescription>
            {creating
              ? requireEmail
                ? "The name, phone, email and Maher ID are required. The client is created in Zoho FSM as well."
                : "The name and phone are required. The rest can be filled in later."
              : requireEmail
                ? "Saved in Zoho FSM and here. Quotations already issued keep the details they were raised with."
                : "Quotations already issued keep the details they were raised with — this changes what future documents carry."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Name" htmlFor="client-name" required error={nameError ? "A name needs at least two characters." : undefined}>
            <Input
              id="client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Who the job is for"
              aria-invalid={nameError || undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Phone"
              htmlFor="client-phone"
              required
              error={
                phoneError
                  ? "Enter the full number, with at least six digits."
                  : !creating && !phone.trim()
                    ? CLIENT_PHONE_REQUIRED
                    : undefined
              }
            >
              <PhoneInput id="client-phone" value={phone} onChange={setPhone} />
            </Field>
            <Field label="Email" htmlFor="client-email" required={requireEmail} error={emailError}>
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
              />
            </Field>
          </div>

          {requireEmail ? (
            <Field
              label="Maher ID"
              htmlFor="client-maher-id"
              required
              error={!creating && !maherId.trim() ? "Zoho FSM requires a Maher ID." : undefined}
            >
              <Input
                id="client-maher-id"
                value={maherId}
                onChange={(event) => setMaherId(event.target.value)}
                placeholder="e.g. C0354059"
              />
            </Field>
          ) : null}

          <Field label="Company" htmlFor="client-company">
            <Input
              id="client-company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder="Agency or developer, if any"
            />
          </Field>

          {!creating ? (
            <Field label="Notes" htmlFor="client-notes">
              <Textarea
                id="client-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Anything the team should know before calling…"
              />
            </Field>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void save()}
            pending={saving}
            pendingLabel="Saving…"
            disabled={!canSave}
          >
            {creating ? "Add client" : "Save changes"}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-medium">
        {label}
        {required ? <span className="text-brand"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
