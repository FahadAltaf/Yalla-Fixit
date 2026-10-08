"use client";

import { useCallback, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Save, Search, Trash2, TriangleAlert, Workflow } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { cn } from "@/lib/utils";
import {
  amcContractsService,
  type FsmServiceMappingOverview,
  type FsmWorkOrderForAmc,
} from "@/modules/amc-contracts/amc-contracts-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { ConfigTableToolbar, LocalDataTable } from "./config-table";

type Service = FsmServiceMappingOverview["services"][number];

/* Theme tones: linked, linked but switched off, not linked yet. */
const STATUS_TONES: Record<string, string> = {
  mapped: "bg-success/10 text-success",
  inactive: "bg-warning/10 text-warning",
  unmapped: "bg-mist text-ink-soft",
};
const STATUS_LABELS: Record<string, string> = { mapped: "Mapped", inactive: "Inactive", unmapped: "Unmapped" };

/**
 * AMC service -> Zoho FSM service. The two catalogues share no identifier,
 * so the link is kept here, by FSM Services record id. FSM service ids are
 * found from a real work order's service lines; nothing is guessed from a
 * name. Approvers edit; everyone with AMC access can see it.
 */
export function FsmServiceMapping() {
  useBreadcrumbLabel("fsm-services", "FSM service mapping");
  const [data, setData] = useState<FsmServiceMappingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The service being edited; kept while the dialog closes so its content does not blank mid-animation. */
  const [editing, setEditing] = useState<Service | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [pageSize, setPageSize] = useState(10);

  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    let stale = false;
    amcContractsService.fsmServices().then(
      (next) => !stale && setData(next),
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not load the mapping."),
    );
    return () => {
      stale = true;
    };
  }, [attempt]);

  const services = data?.services ?? [];
  const mapped = services.filter((s) => s.status === "mapped").length;
  const canEdit = Boolean(data?.canEdit && data.migrated);
  const term = search.trim().toLowerCase();
  const shown = services.filter(
    (s) =>
      (status === "all" || s.status === status) &&
      (!term || `${s.label} ${s.amcServiceId} ${s.fsmServiceName ?? ""} ${s.fsmServiceId ?? ""}`.toLowerCase().includes(term)),
  );
  const open = (service: Service) => {
    setEditing(service);
    setDialogOpen(true);
  };

  const columns: ColumnDef<Service, unknown>[] = [
    {
      id: "amc",
      header: "AMC service",
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.label}</span>
          <span className="text-muted-foreground truncate text-xs">{row.original.amcServiceId}</span>
        </div>
      ),
    },
    {
      id: "fsm",
      header: "FSM service",
      cell: ({ row }) =>
        row.original.fsmServiceId ? (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm">{row.original.fsmServiceName ?? "—"}</span>
            <span className="text-muted-foreground truncate text-xs tabular-nums">{row.original.fsmServiceId}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">Not mapped</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="secondary" className={cn("border-0 font-medium", STATUS_TONES[row.original.status])}>
          {STATUS_LABELS[row.original.status] ?? row.original.status}
        </Badge>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }) => (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit the mapping for ${row.original.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    open(row.original);
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              </div>
            ),
          } satisfies ColumnDef<Service, unknown>,
        ]
      : []),
  ];

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Configuration"
        title="FSM service mapping"
        description="Which Zoho FSM service each AMC service corresponds to. FSM work is matched to a contract's services through this."
        actions={<AmcNotificationsBell />}
      />
      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5">
          <TriangleAlert className="text-warning" />
          <AlertTitle>The mapping cannot be changed yet</AlertTitle>
          <AlertDescription>Needs migration 20261006120000 (AMC FSM integration).</AlertDescription>
        </Alert>
      ) : null}
      {error ? <ErrorState title="Could not load the mapping" message={error} onRetry={load} /> : null}

      <SectionCard
        title="Services"
        description={
          data
            ? `${mapped} of ${services.length} AMC services mapped.${data.canEdit ? "" : " Only AMC approvers can change this."}`
            : "Each AMC service and the FSM service it is matched to."
        }
        icon={<Workflow />}
      >
        <LocalDataTable
          columns={columns}
          rows={shown}
          loading={!data && !error}
          pageSize={pageSize}
          resetKey={`${term}|${status}`}
          onRowClick={canEdit ? open : undefined}
          toolbar={
            <ConfigTableToolbar
              search={search}
              onSearchChange={setSearch}
              placeholder="Search by AMC or FSM service…"
              searchLabel="Search services"
              loading={!data && !error}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
              onRefresh={load}
              filters={
                <StatusSelect
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "all", label: "All", count: services.length },
                    ...(["mapped", "inactive", "unmapped"] as const).map((s) => ({
                      value: s,
                      label: STATUS_LABELS[s],
                      count: services.filter((x) => x.status === s).length,
                    })),
                  ]}
                />
              }
            />
          }
          emptyState={
            services.length === 0 ? (
              <EmptyState icon={<Workflow />} title="No AMC services yet" description="Services appear here once they are in the AMC catalogue." />
            ) : (
              <EmptyState icon={<Workflow />} title="No services match" description="Try another name or id, or show every status." />
            )
          }
        />
      </SectionCard>

      <EditMappingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        service={editing}
        onSaved={(next) => {
          setData((prev) => (prev ? { ...next, canEdit: prev.canEdit } : next));
          setDialogOpen(false);
        }}
      />
    </div>
  );
}

function EditMappingDialog({
  open,
  onOpenChange,
  service,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service | null;
  onSaved: (data: FsmServiceMappingOverview) => void;
}) {
  const [fsmServiceId, setFsmServiceId] = useState(service?.fsmServiceId ?? "");
  const [fsmServiceName, setFsmServiceName] = useState(service?.fsmServiceName ?? "");
  const [active, setActive] = useState(service?.status !== "inactive");
  const [woRef, setWoRef] = useState("");
  const [wo, setWo] = useState<FsmWorkOrderForAmc | null>(null);
  /* Which action is running, so only its button shows the spinner. */
  const [busy, setBusy] = useState<null | "find" | "save" | "remove">(null);
  /* Each opening starts from the stored mapping, seeded during render so the previous service never paints. */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setFsmServiceId(service?.fsmServiceId ?? "");
      setFsmServiceName(service?.fsmServiceName ?? "");
      setActive(service?.status !== "inactive");
      setWoRef("");
      setWo(null);
    }
  }

  const find = async () => {
    setBusy("find");
    try {
      setWo((await amcContractsService.fsmWorkOrder(woRef.trim())).workOrder);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not find the work order.");
    } finally {
      setBusy(null);
    }
  };

  const save = async (remove = false) => {
    if (!service) return;
    setBusy(remove ? "remove" : "save");
    try {
      const next = await amcContractsService.saveFsmService({
        amcServiceId: service.amcServiceId,
        fsmServiceId: remove ? null : fsmServiceId.trim(),
        fsmServiceName: remove ? null : fsmServiceName.trim() || null,
        active,
      });
      toast.success(remove ? "Mapping removed" : "Mapping saved");
      onSaved(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the mapping.");
    } finally {
      setBusy(null);
    }
  };

  const servicesOnWo = wo
    ? [...new Map(wo.lines.filter((l) => l.serviceId).map((l) => [l.serviceId!, l])).values()]
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy !== null} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Map {service?.label ?? "service"}</DialogTitle>
          <DialogDescription>
            Find the FSM service on a work order that has this kind of work, or enter its FSM id.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="amc-map-wo">Find from a work order</Label>
            <div className="flex gap-2">
              <Input id="amc-map-wo" placeholder="e.g. WO731" value={woRef} onChange={(e) => setWoRef(e.target.value)} />
              <SubmitButton
                variant="outline"
                pending={busy === "find"}
                pendingLabel="Finding…"
                icon={<Search className="size-4" />}
                onClick={() => void find()}
                disabled={busy !== null || woRef.trim().length < 2}
              >
                Find
              </SubmitButton>
            </div>
            {wo ? (
              servicesOnWo.length ? (
                <ul className="divide-y rounded-lg border text-sm">
                  {servicesOnWo.map((l) => (
                    <li key={l.serviceId}>
                      <button
                        type="button"
                        className="hover:bg-muted flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                        onClick={() => {
                          setFsmServiceId(l.serviceId ?? "");
                          setFsmServiceName(l.serviceName ?? "");
                        }}
                      >
                        <span>{l.serviceName ?? "Unnamed service"}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {l.serviceId}
                          {l.amcServiceId && l.amcServiceId !== service?.amcServiceId ? ` (mapped to ${l.amcServiceId})` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">That work order has no services on its lines.</p>
              )
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="amc-map-id">FSM service id</Label>
              <Input id="amc-map-id" value={fsmServiceId} maxLength={40} onChange={(e) => setFsmServiceId(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amc-map-name">FSM service name</Label>
              <Input id="amc-map-name" value={fsmServiceName} maxLength={200} onChange={(e) => setFsmServiceName(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} aria-label="Active" />
            Active (used to match FSM work)
          </label>
        </div>
        <DialogFooter>
          {service?.fsmServiceId ? (
            <SubmitButton
              variant="ghost"
              className="text-destructive hover:text-destructive mr-auto"
              pending={busy === "remove"}
              pendingLabel="Removing…"
              icon={<Trash2 className="size-4" />}
              onClick={() => void save(true)}
              disabled={busy !== null}
            >
              Remove mapping
            </SubmitButton>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Cancel
          </Button>
          <SubmitButton
            pending={busy === "save"}
            pendingLabel="Saving…"
            icon={<Save className="size-4" />}
            onClick={() => void save()}
            disabled={busy !== null || !/^[A-Za-z0-9_-]+$/.test(fsmServiceId.trim())}
          >
            Save
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
