"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, EllipsisVerticalIcon, FileText, Layers, MapPin, Plus, UserRound, Users } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { DataRow, PageHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { LIFECYCLE_LABELS } from "@/lib/amc/client-profile";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type CustomerInput, type CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
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

/**
 * The AMC clients: the same people as Snagging's Clients page, with what
 * AMC keeps about them (Customer ID, status). Searched on the server; the
 * answer is paged here, since the list call has no paging of its own.
 */
export function CustomersPage() {
  useBreadcrumbLabel("customers", "Clients");
  const router = useRouter();
  const [q, setQ] = useState("");
  const term = useDebounce(q.trim(), 250);
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const { data, error, loading, reload } = useAmcData(
    () => amcContractsService.customers(term, lifecycle === "all" ? null : lifecycle, 200),
    `customers|${term}|${lifecycle}`,
  );
  const adding = useDialog();
  const addresses = useDialog<CustomerRecord>();
  const { show: showAddresses } = addresses;

  const all = data?.customers ?? [];
  const rows = all.slice(page * pageSize, (page + 1) * pageSize);
  const filtered = Boolean(term) || lifecycle !== "all";

  const columns = useMemo<ColumnDef<CustomerRecord>[]>(
    () => [
      {
        id: "name",
        header: "Client",
        enableSorting: false,
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.name}
            subtitle={[row.original.email, row.original.phone].filter(Boolean).join(" · ") || "No contact details"}
          />
        ),
      },
      {
        id: "company",
        header: "Company",
        enableSorting: false,
        cell: ({ row }) => (row.original.company ? <span className="text-sm">{row.original.company}</span> : <span className="text-muted-foreground text-sm">—</span>),
      },
      {
        id: "customerRef",
        header: "Customer ID",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.customerRef ? <span className="text-sm tabular-nums">{row.original.customerRef}</span> : <span className="text-muted-foreground text-sm">—</span>,
      },
      {
        id: "lifecycle",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant="secondary" className={`border-0 font-medium ${LIFECYCLE_TONE[row.original.lifecycle]}`}>
            {LIFECYCLE_LABELS[row.original.lifecycle]}
          </Badge>
        ),
      },
      {
        id: "addresses",
        header: "Properties",
        enableSorting: false,
        // Like Snagging's Clients page: the client's addresses open in place.
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              showAddresses(row.original);
            }}
            aria-label={`View the properties of ${row.original.name}`}
          >
            <MapPin className="size-3.5" aria-hidden />
            Properties
          </Button>
        ),
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
                <DropdownMenuItem onClick={() => router.push(clientHref(row.original.id))}>
                  <UserRound className="size-4" />
                  Open client
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => showAddresses(row.original)}>
                  <Building2 className="size-4" />
                  Properties
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(clientHref(row.original.id, "contacts"))}>
                  <Users className="size-4" />
                  Contacts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(clientHref(row.original.id, "documents"))}>
                  <FileText className="size-4" />
                  Documents
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [router, showAddresses],
  );

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Master data"
        title="Clients"
        description="The same clients and addresses as Snagging. Contracts keep what was signed; these records say who the client is today."
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

      {error ? <ErrorState title="Could not load clients" message={error} onRetry={reload} /> : null}

      <Card className="py-0">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          rowCount={all.length}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          onGlobalFilterChange={(value) => {
            setQ(value);
            setPage(0);
          }}
          handleRowClick={(c) => router.push(clientHref(c.id))}
          toolbar={
            <ClientsToolbar
              search={q}
              onSearchChange={(value) => {
                setQ(value);
                setPage(0);
              }}
              loading={loading || q.trim() !== term}
              statusOptions={LIFECYCLE_OPTIONS}
              status={lifecycle}
              onStatusChange={(value) => {
                setLifecycle(value as LifecycleFilter);
                setPage(0);
              }}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onRefresh={reload}
            />
          }
          emptyState={
            error ? (
              <EmptyState icon={<Users className="size-5" />} title="Nothing to show" description="The list did not load. Try again above." />
            ) : filtered ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="No client matches that"
                description="Try part of the name, phone or Customer ID, or another status."
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
                description="Clients come from Snagging and from AMC enquiries. Add one here, or link one from a contract."
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
        description="Only the name is required. Signed contracts keep their own copy of these details."
        submitLabel="Add client"
        initial={{ name: "", lifecycle: "client" }}
        onSave={async (input) => {
          const { customer } = await amcContractsService.createCustomer(input);
          toast.success("Client added");
          router.push(clientHref(customer.id));
        }}
      />

      <ClientPropertiesDialog customer={addresses.target} open={addresses.open} onOpenChange={addresses.onOpenChange} />
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
