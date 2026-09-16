"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { SnaggingClientsToolbar } from "@/components/data-table/toolbars/snagging-clients-toolbar";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { cn } from "@/lib/utils";
import {
  snaggingService,
  type SnaggingClientOption,
} from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import { ErrorState, PageHeading, SubmitButton } from "./shared";


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
export default function ClientsAdmin() {
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

  const [clients, setClients] = useState<SnaggingClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<SnaggingClientOption | null>(null);
  /** Distinguishes "add a client" from "edit this one" in the same dialog. */
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClients(await snaggingService.searchClients(undefined, { withCounts: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load clients");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Filtered here rather than by refetching on every keystroke. The whole
    list is already on the page — the API caps at 400 — so searching is a
    local operation, and making it a request would put a network round trip
    between a letter and the row it reveals.
  */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) =>
      [c.client_name, c.client_email, c.client_phone, c.company]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [clients, search]);

  const paginated = useMemo(
    () => filtered.slice(page * pageSize, page * pageSize + pageSize),
    [filtered, page, pageSize],
  );

  const columns = useMemo<ColumnDef<SnaggingClientOption>[]>(
    () => [
      {
        id: "client_name",
        header: "Client",
        accessorKey: "client_name",
        cell: ({ row }) => (
          /*
            The shared identity cell, not a hand-rolled avatar. It hashes
            the colour off a stable seed, so a client keeps the same colour
            on every screen — which a locally built AvatarFallback did not,
            giving every row the same grey circle.
          */
          <IdentityCell
            title={row.original.client_name}
            subtitle={row.original.company || "No company recorded"}
            seed={row.original.id ?? row.original.client_name}
          />
        ),
      },
      {
        id: "client_phone",
        header: "Phone",
        accessorKey: "client_phone",
        cell: ({ row }) => (
          <Contact icon={Phone} value={row.original.client_phone} />
        ),
      },
      {
        id: "client_email",
        header: "Email",
        accessorKey: "client_email",
        cell: ({ row }) => (
          <Contact icon={Mail} value={row.original.client_email} />
        ),
      },
      {
        id: "job_count",
        header: "Jobs",
        accessorKey: "job_count",
        cell: ({ row }) => {
          const count = row.original.job_count ?? 0;
          return (
            <Badge
              className={cn(
                "rounded-sm border-none",
                count > 0
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Briefcase className="mr-1 size-3" />
              {count === 0 ? "None yet" : count}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: () => "Actions",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) =>
          canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${row.original.client_name}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setCreating(false);
                    setEditing(row.original);
                  }}
                >
                  <Pencil className="size-4" /> Edit details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [canEdit],
  );

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          eyebrow="Master data"
          title="Clients"
          description="Everyone jobs and quotations are raised for."
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
          description="Everyone jobs and quotations are raised for. Correct a phone number or an email here and every future document picks it up."
        />


      <Card className="py-0">
        <DataTable
          columns={columns}
          data={paginated}
          loading={loading}
          rowCount={filtered.length}
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
                  ? "Try a partial phone number, or part of the company name."
                  : "Clients are created with their first job, and appear here once they are."
              }
            />
          }
        />
      </Card>

      <ClientDialog
        client={editing}
        creating={creating}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
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
  onClose,
  onSaved,
}: {
  client: SnaggingClientOption | null;
  creating: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(client?.client_name ?? "");
    setEmail(client?.client_email ?? "");
    setPhone(client?.client_phone ?? "");
    setCompany(client?.company ?? "");
    setNotes(client?.notes ?? "");
  }, [client]);

  const nameError = name.trim().length > 0 && name.trim().length < 2;
  const canSave = name.trim().length >= 2 && !saving;

  async function save() {
    if (!client || !canSave) return;
    setSaving(true);
    try {
      if (creating || !client.id) {
        await snaggingService.createClient({
          client_name: name.trim(),
          client_email: email.trim() || undefined,
          client_phone: phone.trim() || undefined,
          company: company.trim() || undefined,
        });
        toast.success("Client added");
      } else {
        await snaggingService.updateClient({
          id: client.id,
          client_name: name.trim(),
          client_email: email.trim() || null,
          client_phone: phone.trim() || null,
          company: company.trim() || null,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {creating ? "Add a client" : `Edit ${client?.client_name}`}
          </DialogTitle>
          <DialogDescription>
            {creating
              ? "Only the name is required. The rest can be filled in later."
              : "Quotations already issued keep the details they were raised with — this changes what future documents carry."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Name" htmlFor="client-name" error={nameError ? "A name needs at least two characters." : undefined}>
            <Input
              id="client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Who the job is for"
              aria-invalid={nameError || undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="client-phone">
              <Input
                id="client-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+971…"
                inputMode="tel"
              />
            </Field>
            <Field label="Email" htmlFor="client-email">
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
              />
            </Field>
          </div>

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
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-medium">
        {label}
      </Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
