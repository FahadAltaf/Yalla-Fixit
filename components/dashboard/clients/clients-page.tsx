"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, EllipsisVerticalIcon, Layers, Loader2, Mail, MapPin, Phone, Plus, SquarePen, UserRound, Users } from "lucide-react";
import { toast } from "sonner";

import { ClientsToolbar } from "@/components/dashboard/extensions/amc-contracts/clients-toolbar";
import { ModuleGuide } from "@/components/dashboard/extensions/amc-contracts/module-guide";
import { UNIT_TYPE_LABELS } from "@/components/dashboard/extensions/amc-contracts/customer-pickers";
import { LIFECYCLE_TONE } from "@/components/dashboard/extensions/amc-contracts/profile/identity-card";
import { useAmcData } from "@/components/dashboard/extensions/amc-contracts/use-amc-data";
import { DataRow, PageHeading } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { ClientAddressesDialog } from "@/components/dashboard/snagging/client-addresses-dialog";
import { ExistingClientDialog } from "@/components/dashboard/snagging/existing-client-dialog";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useAuth } from "@/context/AuthContext";
import { useDebounce } from "@/hooks/use-debounce";
import { LIFECYCLE_LABELS } from "@/lib/amc/client-profile";
import { clientHref, clientsAccess } from "@/lib/clients/access";
import { formatPhone } from "@/lib/phone/format-phone";
import { hasResourceAction } from "@/lib/role-permissions";
import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";
import { clientIdForRow, clientsService, type ClientLifecycle, type ClientRow } from "@/modules/clients/clients-service";
import type { SnaggingClientOption } from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import { ClientDialog } from "./client-dialog";

type LifecycleFilter = "all" | ClientLifecycle;

const LIFECYCLE_OPTIONS: ReadonlyArray<{ value: LifecycleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "prospect", label: "Prospects" },
  { value: "client", label: "Clients" },
  { value: "former", label: "Former clients" },
];

const rowKey = (row: ClientRow) => row.fsmContactId ?? row.id ?? row.name;

/** A contact line, or an honest blank where there is nothing to call. */
function Contact({ icon: Icon, value }: { icon: typeof Phone; value: string | null }) {
  if (!value) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <span className="flex max-w-64 min-w-0 items-center gap-2 text-sm">
      <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <TruncatedText text={value} />
    </span>
  );
}

/**
 * Clients, one list for the whole portal (26 Nov 2026, the user: "we have
 * clients in both amc and snagging so ... show outside the amc and snagging,
 * manage both together, and in menu only show open client and edit client").
 *
 * The clients were always one set of records (Snagging's, which AMC uses);
 * this is the one page for them, in place of AMC's Clients and Snagging's.
 * Read from Zoho FSM newest first, with AMC's prospects FSM has not got yet
 * on the first page. AMC's status shows for someone with AMC's view.
 */
export function ClientsPage() {
  const router = useRouter();
  const { userProfile } = useAuth();
  const access = clientsAccess(userProfile);
  // The addresses popup is Snagging's (the same records); AMC's properties list otherwise.
  const snaggingAddresses = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.VIEW);
  const canEditAddresses = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE) || hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EDIT);
  const canEdit = access.editViaSnagging || access.amc;

  const [q, setQ] = useState("");
  const term = useDebounce(q.trim(), 300);
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [source, setSource] = useState<"fsm" | "portal">("fsm");
  const [writesToFsm, setWritesToFsm] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The row being linked to the portal before it opens.
  const [opening, setOpening] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ key: number; clientId: string | null } | null>(null);
  const [addressesFor, setAddressesFor] = useState<{ id: string; name: string; row: ClientRow } | null>(null);
  const [existing, setExisting] = useState<SnaggingClientOption | null>(null);

  /* Only the latest request may fill the table. */
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await clientsService.page({ q: term, page, pageSize, lifecycle: lifecycle === "all" ? null : lifecycle });
      if (mine !== ticket.current) return;
      setRows(result.clients);
      setHasMore(result.hasMore);
      setSource(result.source);
      setWritesToFsm(result.writesToFsm);
      setNotice(result.notice ?? null);
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : "Could not load clients.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [term, page, pageSize, lifecycle]);

  useEffect(() => {
    void load();
  }, [load]);

  /* A client listed from FSM has no portal row until it is used: it is made here (FSM is only read). */
  const withClient = useCallback(async (row: ClientRow, then: (id: string) => void) => {
    const key = rowKey(row);
    setOpening(key);
    try {
      const id = await clientIdForRow(row);
      setRows((list) => list.map((r) => (rowKey(r) === key ? { ...r, id } : r)));
      then(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open this client.");
    } finally {
      setOpening(null);
    }
  }, []);

  const openClient = useCallback((row: ClientRow) => void withClient(row, (id) => router.push(clientHref(id))), [withClient, router]);
  const editClient = useCallback((row: ClientRow) => void withClient(row, (id) => setDialog({ key: Date.now(), clientId: id })), [withClient]);

  const columns = useMemo<ColumnDef<ClientRow>[]>(() => {
    const list: ColumnDef<ClientRow>[] = [
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
      { id: "phone", header: "Phone", enableSorting: false, cell: ({ row }) => <Contact icon={Phone} value={formatPhone(row.original.phone) || null} /> },
      { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => <Contact icon={Mail} value={row.original.email} /> },
    ];
    if (access.amc) {
      list.push({
        id: "lifecycle",
        header: "AMC status",
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
      });
    }
    list.push(
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
                void withClient(row.original, (id) => setAddressesFor({ id, name: row.original.name, row: row.original }));
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
              {/* Only these two (26 Nov 2026): the rest is on the client's page. */}
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openClient(row.original)}>
                  <UserRound className="size-4" />
                  Open client
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem onClick={() => editClient(row.original)}>
                    <SquarePen className="size-4" />
                    Edit client
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    );
    return list;
  }, [access.amc, canEdit, opening, withClient, openClient, editClient]);

  const resetPage = <T,>(apply: (value: T) => void) => (value: T) => {
    apply(value);
    setPage(0);
  };
  const filtered = Boolean(term) || lifecycle !== "all";

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Master data"
        title="Clients"
        info={access.amc ? <ModuleGuide module="clients" /> : undefined}
        description={
          source === "fsm"
            ? "Everyone AMC and Snagging work for, in one list, read from Zoho FSM. Edits here are saved in FSM too."
            : "Everyone AMC and Snagging work for, in one list."
        }
        actions={
          access.create ? (
            <Button onClick={() => setDialog({ key: Date.now(), clientId: null })}>
              <Plus className="size-4" />
              Add client
            </Button>
          ) : null
        }
      />

      {error ? <ErrorState title="Could not load clients" message={error} onRetry={() => void load()} /> : null}
      {notice && !error ? <p className="border-warning/30 bg-warning/5 text-muted-foreground rounded-lg border px-4 py-3 text-sm">{notice}</p> : null}

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
          handleRowClick={(row) => openClient(row)}
          toolbar={
            <ClientsToolbar
              search={q}
              onSearchChange={resetPage(setQ)}
              loading={loading || q.trim() !== term}
              {...(access.amc
                ? { statusOptions: LIFECYCLE_OPTIONS, status: lifecycle, onStatusChange: (value: string) => resetPage(setLifecycle)(value as LifecycleFilter) }
                : {})}
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
                description={source === "fsm" && lifecycle === "all" ? "Zoho FSM searches the last name, the email and the phone number. Try one of those." : "Try part of the name, phone or Customer ID, or another status."}
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
                description="Clients come from Zoho FSM, AMC enquiries and Snagging quotations."
                action={access.create ? { label: "Add client", onClick: () => setDialog({ key: Date.now(), clientId: null }) } : undefined}
              />
            )
          }
        />
      </Card>

      {dialog ? (
        <ClientDialog
          key={dialog.key}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          clientId={dialog.clientId}
          writesToFsm={writesToFsm}
          onSaved={(client) => {
            void load();
            if (dialog.clientId) return;
            /* FSM already had the email: nothing new was made. Said in a popup (UAT retest, point 1). */
            if (client.existed) {
              void clientsService.get(client.id).then(
                ({ client: c }) => setExisting({ id: c.id, client_name: c.name, client_email: c.email, client_phone: c.phone, company: c.company }),
                () => router.push(clientHref(client.id)),
              );
              return;
            }
            toast.success("Client added", { description: "Add their address on their page so it fills in on quotations and proposals." });
            router.push(clientHref(client.id, "properties"));
          }}
        />
      ) : null}

      <ExistingClientDialog client={existing} onClose={() => setExisting(null)} action={{ label: "Open client", onClick: (c) => c.id && router.push(clientHref(c.id)) }} />

      {snaggingAddresses ? (
        <ClientAddressesDialog
          client={addressesFor ? { id: addressesFor.id, fsm_contact_id: addressesFor.row.fsmContactId, client_name: addressesFor.name, client_email: addressesFor.row.email, client_phone: addressesFor.row.phone, company: addressesFor.row.company } : null}
          canEdit={canEditAddresses}
          onClose={() => setAddressesFor(null)}
          onChanged={() => undefined}
        />
      ) : (
        <ClientPropertiesDialog client={addressesFor} onClose={() => setAddressesFor(null)} />
      )}
    </div>
  );
}

/** A client's properties (AMC's view), opened from the list as Snagging opens a client's addresses. */
function ClientPropertiesDialog({ client, onClose }: { client: { id: string; name: string } | null; onClose: () => void }) {
  return (
    <Dialog open={client !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? `${client.name}'s properties` : "Properties"}</DialogTitle>
          <DialogDescription>The addresses on file for this client. Open one for its contract, assets and access rules.</DialogDescription>
        </DialogHeader>
        {client ? <ClientPropertiesList customerId={client.id} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {client ? (
            <Button asChild>
              <Link href={clientHref(client.id, "properties")}>
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
