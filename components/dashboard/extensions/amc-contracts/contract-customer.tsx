"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataRow, SectionCard, SubHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
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
  const [linking, setLinking] = useState<"customer" | "property" | null>(null);

  useEffect(() => {
    let stale = false;
    amcContractsService.links(contract.id).then(
      ({ links: next }) => !stale && setLinks(next),
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not load the links."),
    );
    return () => {
      stale = true;
    };
  }, [contract.id]);

  const signed = contract.customer as Record<string, string | undefined>;
  const signedProperty = contract.property as Record<string, string | undefined>;

  return (
    <SectionCard title="Customer and property" icon={<UserRound />} bodyClassName="px-5 pb-5 space-y-3">
      <SubHeading>As signed</SubHeading>
      <DataRow title={contract.customerName || "—"} subtitle={contract.customerRef ? `Customer ID ${contract.customerRef}` : "Customer"} />
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
        <p className="text-destructive text-sm">{error}</p>
      ) : !links ? (
        <ListSkeleton rows={2} />
      ) : !links.migrated ? (
        <p className="text-muted-foreground text-xs">Needs migration 20261006130000 to link customer records.</p>
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
                "No customer record linked"
              )
            }
            subtitle={
              links.customer
                ? [links.customer.customerRef, links.customer.phone, links.customer.email].filter(Boolean).join(" · ") || "Customer record"
                : "Link one to see this customer's other contracts"
            }
            trailing={
              canManage ? (
                <Button size="sm" variant="ghost" onClick={() => setLinking("customer")}>
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
                <Button size="sm" variant="ghost" onClick={() => setLinking("property")}>
                  {links.property ? "Change" : "Link"}
                </Button>
              ) : null
            }
          />
          <p className="text-muted-foreground text-xs">Editing the customer or property record never changes what was signed.</p>
        </>
      )}

      {linking && links ? (
        <LinkDialog
          kind={linking}
          contractId={contract.id}
          links={links}
          onOpenChange={(next) => !next && setLinking(null)}
          onDone={(next) => {
            setLinks(next);
            setLinking(null);
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function LinkDialog({
  kind,
  contractId,
  links,
  onOpenChange,
  onDone,
}: {
  kind: "customer" | "property";
  contractId: string;
  links: LiveLinks;
  onOpenChange: (open: boolean) => void;
  onDone: (links: LiveLinks) => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (input: { id?: string | null; createFromSnapshot?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const { links: next } = await amcContractsService.setLink(contractId, { kind, ...input });
      toast.success(input.id === null ? `${kind === "customer" ? "Customer" : "Property"} unlinked` : `${kind === "customer" ? "Customer" : "Property"} linked`);
      onDone(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the link.");
    } finally {
      setBusy(false);
    }
  };

  const current = kind === "customer" ? links.customer : links.property;

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link the {kind}</DialogTitle>
          <DialogDescription>
            {kind === "customer"
              ? "Pick the customer record, or make one from what was signed. Customers are never matched by name automatically."
              : links.customer
                ? `Pick one of ${links.customer.name}'s properties, or make one from what was signed.`
                : "Link the customer first to choose from their properties, or make one from what was signed."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {kind === "customer" ? (
            <CustomerSearch selectedId={pickedId} onPick={(c) => setPickedId(c.id)} />
          ) : (
            <PropertySelect customerId={links.customer?.id ?? null} value={pickedId} onChange={(p) => setPickedId(p?.id ?? null)} />
          )}
          <Button variant="outline" onClick={() => void save({ createFromSnapshot: true })} disabled={busy}>
            Create from the signed {kind}
          </Button>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
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
          <Button onClick={() => void save({ id: pickedId })} disabled={busy || !pickedId}>
            Link
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
