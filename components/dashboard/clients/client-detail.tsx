"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, MapPin, SquarePen, UserX } from "lucide-react";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { CustomerDetail } from "@/components/dashboard/extensions/amc-contracts/customer-property-views";
import { DetailToolbar } from "@/components/dashboard/extensions/amc-contracts/detail-header";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { ClientAddressesDialog } from "@/components/dashboard/snagging/client-addresses-dialog";
import { ClientJobsTable } from "@/components/dashboard/snagging/client-jobs-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { CLIENTS_HREF, clientsAccess } from "@/lib/clients/access";
import { formatPhone } from "@/lib/phone/format-phone";
import { hasResourceAction } from "@/lib/role-permissions";
import { clientsService, type ClientForEdit } from "@/modules/clients/clients-service";
import { ActionType, ResourceType } from "@/types/types";

import { ClientDialog } from "./client-dialog";

/**
 * A client's page in the Clients module (26 Nov 2026). Someone with AMC's
 * view gets AMC's client page (contracts, visits, payments ... and the
 * client's Snagging jobs when they have Snagging too); someone with
 * Snagging only gets the client, their addresses and their Snagging jobs.
 */
export function ClientDetail({ id }: { id: string }) {
  const { userProfile } = useAuth();
  const access = clientsAccess(userProfile);
  if (access.amc) return <CustomerDetail id={id} />;
  return <SnaggingClientDetail id={id} />;
}

function SnaggingClientDetail({ id }: { id: string }) {
  const router = useRouter();
  const { userProfile } = useAuth();
  const canEditAddresses = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE) || hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EDIT);
  const [state, setState] = useState<{ data: ClientForEdit; at: number } | { error: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [addresses, setAddresses] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setState({ data: await clientsService.get(id), at: Date.now() });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : "Could not load this client." });
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = state && "data" in state ? state.data : null;
  useBreadcrumbLabel(id, data?.client.name ?? "Client");

  const toolbar = <DetailToolbar backHref={CLIENTS_HREF} backLabel="Clients" fetchedAt={state && "at" in state ? state.at : null} refreshing={refreshing} onRefresh={data ? () => void load() : undefined} />;

  if (state === null) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        <Card className="gap-3 p-5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </Card>
        <SectionSkeleton />
      </div>
    );
  }
  if ("error" in state) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        {/not found/i.test(state.error) ? (
          <Card className="p-0">
            <EmptyState icon={<UserX className="size-5" />} title="Client not found" description="Find the client in the list instead." action={{ label: "Back to clients", onClick: () => router.push(CLIENTS_HREF) }} />
          </Card>
        ) : (
          <ErrorState title="Could not load this client" message={state.error} onRetry={() => void load()} />
        )}
      </div>
    );
  }

  const { client, canEditContact } = state.data;
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {toolbar}

      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {client.maherId ? <Badge variant="outline">Maher ID {client.maherId}</Badge> : null}
              {client.fsmContactId ? null : <Badge variant="outline">Not in FSM yet</Badge>}
            </div>
            <h2 className="text-2xl">{client.name}</h2>
            <p className="text-muted-foreground text-sm">{[client.company, formatPhone(client.phone), client.email].filter(Boolean).join(" · ") || "No contact details recorded"}</p>
            {client.notes ? <p className="text-muted-foreground max-w-2xl pt-1 text-sm whitespace-pre-line">{client.notes}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setAddresses(true)}>
              <MapPin className="size-4" />
              Addresses
            </Button>
            {canEditContact ? (
              <Button variant="outline" onClick={() => setEditing(Date.now())}>
                <SquarePen className="size-4" />
                Edit client
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <SectionCard title="Snagging jobs" description="Every snagging job raised for this client. Open a row to go to the job." icon={<ClipboardCheck />} bodyClassName="border-t">
        <ClientJobsTable clientId={client.id} />
      </SectionCard>

      {editing !== null ? <ClientDialog key={editing} open onOpenChange={(open) => !open && setEditing(null)} clientId={client.id} onSaved={() => void load()} /> : null}
      <ClientAddressesDialog
        client={addresses ? { id: client.id, fsm_contact_id: client.fsmContactId, client_name: client.name, client_email: client.email, client_phone: client.phone, company: client.company } : null}
        canEdit={canEditAddresses}
        onClose={() => setAddresses(false)}
        onChanged={() => undefined}
      />
    </div>
  );
}
