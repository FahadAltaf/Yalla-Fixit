"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pencil, Workflow } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import {
  amcContractsService,
  type FsmServiceMappingOverview,
  type FsmWorkOrderForAmc,
} from "@/modules/amc-contracts/amc-contracts-service";

type Service = FsmServiceMappingOverview["services"][number];

const STATUS_TONES: Record<string, string> = {
  mapped: "bg-green-600/10 text-green-700 dark:bg-green-400/10 dark:text-green-400",
  inactive: "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400",
  unmapped: "bg-muted text-muted-foreground",
};

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
  const [editing, setEditing] = useState<Service | null>(null);

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

  const mapped = data?.services.filter((s) => s.status === "mapped").length ?? 0;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="AMC contracts"
        title="FSM service mapping"
        description="Which Zoho FSM service each AMC service corresponds to. FSM work is matched to a contract's services through this."
        actions={
          <Button asChild variant="outline">
            <Link href="/extensions/amc-contracts">
              <ArrowLeft className="size-4" />
              AMC contracts
            </Link>
          </Button>
        }
      />
      {error ? (
        <ErrorState title="Could not load the mapping" message={error} onRetry={() => void load()} />
      ) : !data ? (
        <SectionCard title="Services" icon={<Workflow />} bodyClassName="px-5 pb-5">
          <ListSkeleton rows={6} />
        </SectionCard>
      ) : (
        <SectionCard
          title="Services"
          description={
            data.migrated
              ? `${mapped} of ${data.services.length} AMC services mapped.${data.canEdit ? "" : " Only AMC approvers can change this."}`
              : "Needs migration 20261006120000 (AMC FSM integration)."
          }
          icon={<Workflow />}
          bodyClassName="pb-2"
        >
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">AMC service</TableHead>
                  <TableHead>FSM service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.services.map((s) => (
                  <TableRow key={s.amcServiceId}>
                    <TableCell className="pl-5">
                      <div className="font-medium">{s.label}</div>
                      <div className="text-muted-foreground text-xs">{s.amcServiceId}</div>
                    </TableCell>
                    <TableCell>
                      {s.fsmServiceId ? (
                        <div>
                          <div>{s.fsmServiceName ?? "—"}</div>
                          <div className="text-muted-foreground text-xs tabular-nums">{s.fsmServiceId}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not mapped</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`border-none font-normal capitalize ${STATUS_TONES[s.status]}`}>
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      {data.canEdit && data.migrated ? (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          <Pencil className="size-4" />
                          Edit
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
      {editing ? (
        <EditMappingDialog
          service={editing}
          onOpenChange={(next) => !next && setEditing(null)}
          onSaved={(next) => {
            setData((prev) => (prev ? { ...next, canEdit: prev.canEdit } : next));
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function EditMappingDialog({
  service,
  onOpenChange,
  onSaved,
}: {
  service: Service;
  onOpenChange: (open: boolean) => void;
  onSaved: (data: FsmServiceMappingOverview) => void;
}) {
  const [fsmServiceId, setFsmServiceId] = useState(service.fsmServiceId ?? "");
  const [fsmServiceName, setFsmServiceName] = useState(service.fsmServiceName ?? "");
  const [active, setActive] = useState(service.status !== "inactive");
  const [woRef, setWoRef] = useState("");
  const [wo, setWo] = useState<FsmWorkOrderForAmc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      setWo((await amcContractsService.fsmWorkOrder(woRef.trim())).workOrder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find the work order.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (remove = false) => {
    setBusy(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : "Could not save the mapping.");
    } finally {
      setBusy(false);
    }
  };

  const servicesOnWo = wo
    ? [...new Map(wo.lines.filter((l) => l.serviceId).map((l) => [l.serviceId!, l])).values()]
    : [];

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Map {service.label}</DialogTitle>
          <DialogDescription>
            Find the FSM service on a work order that has this kind of work, or enter its FSM id.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="amc-map-wo">Find from a work order</Label>
            <div className="flex gap-2">
              <Input id="amc-map-wo" placeholder="e.g. WO731" value={woRef} onChange={(e) => setWoRef(e.target.value)} />
              <Button variant="outline" onClick={() => void find()} disabled={busy || woRef.trim().length < 2}>
                Find
              </Button>
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
                          {l.amcServiceId && l.amcServiceId !== service.amcServiceId ? ` (mapped to ${l.amcServiceId})` : ""}
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
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {service.fsmServiceId ? (
            <Button variant="ghost" className="mr-auto" onClick={() => void save(true)} disabled={busy}>
              Remove mapping
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !/^[A-Za-z0-9_-]+$/.test(fsmServiceId.trim())}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
