"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Link2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataRow, SectionCard, SubHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { amcContractsService, type ContractDetail, type LiveLinks } from "@/modules/amc-contracts/amc-contracts-service";

import { CustomerSearch, PropertySelect } from "./customer-pickers";

/**
 * Who the customer and property are: as signed (the snapshot, which never
 * changes) and today (the live shared records, which can be edited). The
 * snapshot is what the contract says; the live record is where to reach
 * them now.
 */
export function ContractCustomer({
  contract,
  canManage,
}: {
  contract: ContractDetail["contract"];
  canManage: boolean;
}) {
  const [links, setLinks] = useState<LiveLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /* The kind is kept after the dialog closes, so it animates out unchanged. */
  const [linking, setLinking] = useState<"customer" | "property">("customer");
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    let stale = false;
    amcContractsService.links(contract.id).then(
      ({ links: next }) => !stale && setLinks(next),
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not load the links."),
    );
    return () => {
      stale = true;
    };
  }, [contract.id, attempt]);

  const openLink = (kind: "customer" | "property") => {
    setLinking(kind);
    setLinkOpen(true);
  };

  const signed = contract.customer as Record<string, string | undefined>;
  const signedProperty = contract.property as Record<string, string | undefined>;

  return (
    <SectionCard title="Client and property" icon={<UserRound />} bodyClassName="px-5 pb-5 space-y-3">
      <SubHeading>As signed</SubHeading>
      <DataRow title={contract.customerName || "—"} subtitle={contract.customerRef ? `Client ID ${contract.customerRef}` : "Client"} />
      {signed.customerPhone || signed.customerEmail ? (
        <DataRow title={signed.customerPhone || "—"} subtitle={signed.customerEmail || "Contact"} />
      ) : null}
      <DataRow title={contract.propertyLabel || "—"} subtitle={signedProperty.unitType ? `Property · ${signedProperty.unitType}` : "Property"} />
      <SubHeading>Account managers</SubHeading>
      {contract.accountManagers.length ? (
        contract.accountManagers.map((m, i) => <DataRow key={`${m.name}-${i}`} title={m.name || "—"} subtitle={m.phone || undefined} />)
      ) : (
        <p className="text-muted-foreground text-sm">None named on the signed proposal.</p>
      )}

      <SubHeading>Today</SubHeading>
      {error ? (
        <ErrorState
          title="Could not load the linked records"
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : !links ? (
        <ListSkeleton rows={2} />
      ) : !links.migrated ? (
        <p className="text-muted-foreground text-xs">Needs migration 20261006130000 to link client records.</p>
      ) : (
        <>
          <DataRow
            icon={<UserRound />}
            title={
              links.customer ? (
                <Link href={`/extensions/amc-contracts/customers/${links.customer.id}`} className="hover:underline">
                  {links.customer.name}
                </Link>
              ) : (
                "No client record linked"
              )
            }
            subtitle={
              links.customer
                ? [links.customer.customerRef, links.customer.phone, links.customer.email].filter(Boolean).join(" · ") || "Client record"
                : "Link one to see this client's other contracts"
            }
            trailing={
              canManage ? (
                <Button size="sm" variant="ghost" onClick={() => openLink("customer")}>
                  {links.customer ? "Change" : "Link"}
                </Button>
              ) : null
            }
          />
          <DataRow
            icon={<Building2 />}
            title={
              links.property ? (
                <Link href={`/extensions/amc-contracts/properties/${links.property.id}`} className="hover:underline">
                  {links.property.label}
                </Link>
              ) : (
                "No property record linked"
              )
            }
            subtitle={links.property ? [links.property.unitType, links.property.address].filter(Boolean).join(" · ") || "Property record" : undefined}
            trailing={
              canManage ? (
                <Button size="sm" variant="ghost" onClick={() => openLink("property")}>
                  {links.property ? "Change" : "Link"}
                </Button>
              ) : null
            }
          />
          <p className="text-muted-foreground text-xs">Editing the client or property record never changes what was signed.</p>
        </>
      )}

      {links ? (
        <LinkDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          kind={linking}
          contractId={contract.id}
          links={links}
          onDone={(next) => {
            setLinks(next);
            setLinkOpen(false);
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function LinkDialog({
  open,
  onOpenChange,
  kind,
  contractId,
  links,
  onDone,
}: {
  open: boolean;
  kind: "customer" | "property";
  contractId: string;
  links: LiveLinks;
  onOpenChange: (open: boolean) => void;
  onDone: (links: LiveLinks) => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = kind === "customer" ? "client" : "property";

  useEffect(() => {
    if (open) setPickedId(null);
  }, [open, kind]);

  const save = async (input: { id?: string | null; createFromSnapshot?: boolean }) => {
    setBusy(true);
    try {
      const { links: next } = await amcContractsService.setLink(contractId, { kind, ...input });
      toast.success(input.id === null ? `${kind === "customer" ? "Client" : "Property"} unlinked` : `${kind === "customer" ? "Client" : "Property"} linked`);
      onDone(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the link.");
    } finally {
      setBusy(false);
    }
  };

  const current = kind === "customer" ? links.customer : links.property;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link the {noun}</DialogTitle>
          <DialogDescription>
            {kind === "customer"
              ? "Pick the client record, or make one from what was signed. Clients are never matched by name automatically."
              : links.customer
                ? `Pick one of ${links.customer.name}'s properties, or make one from what was signed.`
                : "Link the client first to choose from their properties, or make one from what was signed."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {kind === "customer" ? (
            <CustomerSearch selectedId={pickedId} onPick={(c) => setPickedId(c.id)} />
          ) : (
            <PropertySelect customerId={links.customer?.id ?? null} value={pickedId} onChange={(p) => setPickedId(p?.id ?? null)} />
          )}
          <Button variant="outline" onClick={() => void save({ createFromSnapshot: true })} disabled={busy}>
            Create from the signed {noun}
          </Button>
        </div>
        <DialogFooter>
          {current ? (
            <Button variant="ghost" className="mr-auto" onClick={() => void save({ id: null })} disabled={busy}>
              Unlink
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void save({ id: pickedId })}
            disabled={!pickedId}
            pending={busy}
            pendingLabel="Saving…"
            icon={<Link2 className="size-4" />}
          >
            Link
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
