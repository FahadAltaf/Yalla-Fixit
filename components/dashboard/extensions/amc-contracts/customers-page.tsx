"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, EllipsisVerticalIcon, FileText, Layers, Loader2, Mail, MapPin, Phone, Plus, UserRound, Users } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { DataTable } from "@/components/data-table";
import { ClientAddressesDialog } from "@/components/dashboard/snagging/client-addresses-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { DataRow, PageHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { useAuth } from "@/context/AuthContext";
import { LIFECYCLE_LABELS } from "@/lib/amc/client-profile";
import { hasResourceAction } from "@/lib/role-permissions";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type ClientListRow, type CustomerInput, type CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";
import type { SnaggingClientOption } from "@/modules/snagging/services/snagging-service";
import { ActionType, ResourceType } from "@/types/types";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { customerForRow } from "./client-picker";
import { ClientsToolbar } from "./clients-toolbar";
import { CustomerFields, UNIT_TYPE_LABELS, cleanCustomer } from "./customer-pickers";
import { useAmcData } from "./use-amc-data";
import { LIFECYCLE_TONE } from "./profile/identity-card";
import { useDialog } from "./profile/use-dialog";

type LifecycleFilter = "all" | "prospect" | "client" | "former";

const LIFECYCLE_OPTIONS: ReadonlyArray<{ value: LifecycleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "prospect", label: "Prospects" },
  { value: "client", label: "Clients" },
  { value: "former", label: "Former clients" },
];

const clientHref = (id: string, tab?: string) => `/extensions/amc-contracts/customers/${id}${tab ? `?tab=${tab}` : ""}`;

/** A row as Snagging's addresses popup takes it. */
const asSnaggingClient = (c: CustomerRecord): SnaggingClientOption => ({
  id: c.id,
  fsm_contact_id: c.fsmContactId,
  client_name: c.name,
  client_email: c.email,
  client_phone: c.phone,
  company: c.company,
});

/** A contact line, or an honest blank where there is nothing to call (as on Snagging). */
function Contact({ icon: Icon, value }: { icon: typeof Phone; value: string | null }) {
  if (!value) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{value}</span>
    </span>
  );
}

/**
 * The AMC clients: the same table as Snagging's Clients page and the same
 * records (snagging_clients and snagging_properties), read from Zoho FSM
 * newest first, ten or more at a time, with what AMC keeps about each one
 * (Customer ID, status) beside it. AMC's own prospects that FSM does not
 * have yet are listed on the first page. A status filter is AMC's own
 * field, so it lists the portal's clients.
 */
export function CustomersPage() {
  useBreadcrumbLabel("customers", "Clients");
  const router = useRouter();
  const { userProfile } = useAuth();
  // The addresses popup is Snagging's own (the same records, edited in one place).
  const snaggingAddresses = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.VIEW);
  const canEditAddresses =
    hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE) || hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EDIT);

  const [q, setQ] = useState("");
  const term = useDebounce(q.trim(), 300);
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState<ClientListRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [source, setSource] = useState<"fsm" | "portal">("fsm");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The row being linked to the portal before it opens.
  const [opening, setOpening] = useState<string | null>(null);
  const adding = useDialog();
  const addresses = useDialog<CustomerRecord>();
  const { show: showAddresses } = addresses;

  /* Only the latest request may fill the table. */
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await amcContractsService.clientsPage({ q: term, page, pageSize, lifecycle: lifecycle === "all" ? null : lifecycle });
      if (mine !== ticket.current) return;
      setRows(result.clients);
      setHasMore(result.hasMore);
      setSource(result.source);
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : "Could not load clients.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [term, page, pageSize, lifecycle]);

  useEffect(() => {
    void load();
  }, [load]);

  const rowKey = (row: ClientListRow) => row.fsmContactId ?? row.id ?? row.name;

  /* A client listed from FSM has no portal row until it is used: it is made here (FSM is only read). */
  const withCustomer = useCallback(async (row: ClientListRow, then: (customer: CustomerRecord) => void) => {
    const key = row.fsmContactId ?? row.id ?? row.name;
    setOpening(key);
    try {
      const customer = await customerForRow(row);
      setRows((list) => list.map((r) => ((r.fsmContactId ?? r.id ?? r.name) === key ? { ...r, id: customer.id, customer, customerRef: customer.customerRef, lifecycle: customer.lifecycle } : r)));
      then(customer);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open this client.");
    } finally {
      setOpening(null);
    }
  }, []);

  const filtered = Boolean(term) || lifecycle !== "all";

  const columns = useMemo<ColumnDef<ClientListRow>[]>(
    () => [
      {
        id: "name",
        header: "Client",
        enableSorting: false,
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.name}
            subtitle={[row.original.company || "No company recorded", row.original.customerRef ? `Customer ID ${row.original.customerRef}` : null].filter(Boolean).join(" · ")}
            seed={row.original.fsmContactId ?? row.original.id ?? row.original.name}
          />
        ),
      },
      {
        id: "phone",
        header: "Phone",
        enableSorting: false,
        cell: ({ row }) => <Contact icon={Phone} value={row.original.phone} />,
      },
      {
        id: "email",
        header: "Email",
        enableSorting: false,
        cell: ({ row }) => <Contact icon={Mail} value={row.original.email} />,
      },
      {
        id: "lifecycle",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            {row.original.lifecycle ? (
              <Badge variant="secondary" className={`border-0 font-medium ${LIFECYCLE_TONE[row.original.lifecycle]}`}>
                {LIFECYCLE_LABELS[row.original.lifecycle]}
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">Not in AMC yet</span>
            )}
            {row.original.portalOnly ? (
              <Badge variant="outline" className="font-medium">
                Not in FSM yet
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "addresses",
        header: "Addresses",
        enableSorting: false,
        cell: ({ row }) => {
          const busy = opening !== null && opening === rowKey(row.original);
          return (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void withCustomer(row.original, showAddresses);
              }}
              aria-label={`Addresses for ${row.original.name}`}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <MapPin className="size-3.5" aria-hidden />}
              Addresses
            </Button>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <EllipsisVerticalIcon className="size-4" />
                  <span className="sr-only">Actions for {row.original.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void withCustomer(row.original, (c) => router.push(clientHref(c.id)))}>
                  <UserRound className="size-4" />
                  Open client
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void withCustomer(row.original, showAddresses)}>
                  <Building2 className="size-4" />
                  Addresses
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void withCustomer(row.original, (c) => router.push(clientHref(c.id, "contacts")))}>
                  <Users className="size-4" />
                  Contacts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void withCustomer(row.original, (c) => router.push(clientHref(c.id, "documents")))}>
                  <FileText className="size-4" />
                  Documents
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [router, showAddresses, opening, withCustomer],
  );

  const resetPage = <T,>(apply: (value: T) => void) => (value: T) => {
    apply(value);
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Master data"
        title="Clients"
        description={
          source === "fsm"
            ? "The same clients and addresses as Snagging, read from Zoho FSM. Contracts keep what was signed; these records say who the client is today."
            : "The same clients and addresses as Snagging. Contracts keep what was signed; these records say who the client is today."
        }
        actions={
          <>
            <AmcNotificationsBell className="size-9" />
            <Button onClick={() => adding.show(true)}>
              <Plus className="size-4" />
              New client
            </Button>
          </>
        }
      />

      {error ? <ErrorState title="Could not load clients" message={error} onRetry={() => void load()} /> : null}

      <Card className="py-0">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          rowCount={0}
          hasMore={hasMore}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={resetPage(setPageSize)}
          onGlobalFilterChange={resetPage(setQ)}
          handleRowClick={(row) => void withCustomer(row, (c) => router.push(clientHref(c.id)))}
          toolbar={
            <ClientsToolbar
              search={q}
              onSearchChange={resetPage(setQ)}
              loading={loading || q.trim() !== term}
              statusOptions={LIFECYCLE_OPTIONS}
              status={lifecycle}
              onStatusChange={(value) => resetPage(setLifecycle)(value as LifecycleFilter)}
              pageSize={pageSize}
              onPageSizeChange={resetPage(setPageSize)}
              onRefresh={() => void load()}
            />
          }
          emptyState={
            error ? (
              <EmptyState icon={<Users className="size-5" />} title="Nothing to show" description="The list did not load. Try again above." />
            ) : filtered ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="No client matches that"
                description={
                  source === "fsm" && lifecycle === "all"
                    ? "Zoho FSM searches the last name, the email and the phone number. Try one of those."
                    : "Try part of the name, phone or Customer ID, or another status."
                }
                action={{
                  label: "Clear filters",
                  variant: "outline",
                  onClick: () => {
                    setQ("");
                    setLifecycle("all");
                    setPage(0);
                  },
                }}
              />
            ) : (
              <EmptyState
                icon={<Users className="size-5" />}
                title="No clients yet"
                description="Clients come from Zoho FSM and from AMC enquiries. Add one here, or link one from a contract."
                action={{ label: "New client", onClick: () => adding.show(true) }}
              />
            )
          }
        />
      </Card>

      <CustomerDialog
        key={adding.key}
        open={adding.open}
        onOpenChange={adding.onOpenChange}
        title="New client"
        description="Only the name is required. Saved in the portal for now; Zoho FSM is only read."
        submitLabel="Add client"
        initial={{ name: "", lifecycle: "client" }}
        onSave={async (input) => {
          const { customer } = await amcContractsService.createCustomer(input);
          toast.success("Client added");
          router.push(clientHref(customer.id));
        }}
      />

      {snaggingAddresses ? (
        <ClientAddressesDialog
          client={addresses.open && addresses.target ? asSnaggingClient(addresses.target) : null}
          canEdit={canEditAddresses}
          onClose={() => addresses.onOpenChange(false)}
          onChanged={() => undefined}
        />
      ) : (
        <ClientPropertiesDialog customer={addresses.target} open={addresses.open} onOpenChange={addresses.onOpenChange} />
      )}
    </div>
  );
}

/** A client's properties, opened from the list the way Snagging opens a client's addresses. */
function ClientPropertiesDialog({ customer, open, onOpenChange }: { customer: CustomerRecord | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{customer ? `${customer.name}'s properties` : "Properties"}</DialogTitle>
          <DialogDescription>The addresses on file for this client. Open one for its contract, assets and access rules.</DialogDescription>
        </DialogHeader>
        {/* Inside the content, so the list is read only while the dialog is open. */}
        {customer ? <ClientPropertiesList customerId={customer.id} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {customer ? (
            <Button asChild>
              <Link href={clientHref(customer.id, "properties")}>
                <UserRound className="size-4" />
                Open client
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientPropertiesList({ customerId }: { customerId: string }) {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.customerProperties(customerId), `properties|${customerId}`);
  if (loading) return <ListSkeleton rows={3} />;
  if (error) return <ErrorState title="Could not load the properties" message={error} onRetry={reload} />;
  const list = data?.properties ?? [];
  if (list.length === 0) {
    return <EmptyState icon={<Building2 className="size-5" />} title="No properties yet" description="Add one from the client's page; it is then offered on their enquiries and site visits." />;
  }
  return (
    <div className="-mx-6 divide-y border-y">
      {list.map((p) => (
        <Link key={p.id} href={`/extensions/amc-contracts/properties/${p.id}`} className="block">
          <DataRow
            className="hover:bg-muted/50 px-6"
            icon={p.parentPropertyId ? <Layers aria-hidden /> : <Building2 aria-hidden />}
            title={p.label}
            subtitle={[p.unitType ? UNIT_TYPE_LABELS[p.unitType as keyof typeof UNIT_TYPE_LABELS] : null, p.address, p.community].filter(Boolean).join(" · ") || "No address recorded"}
          />
        </Link>
      ))}
    </div>
  );
}

/** Add or correct a client. Always mounted; give it a fresh `key` per open. */
export function CustomerDialog({
  open,
  onOpenChange,
  title,
  description = "Signed contracts keep their own copy of these details.",
  submitLabel = "Save changes",
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel?: string;
  initial: CustomerInput;
  /** Does the work and says so; the dialog closes when it resolves. */
  onSave: (input: CustomerInput) => Promise<void>;
}) {
  const [value, setValue] = useState<CustomerInput>(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave(cleanCustomer(value));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the client.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <CustomerFields value={value} onChange={setValue} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…" disabled={!value.name.trim()}>
            {submitLabel}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
