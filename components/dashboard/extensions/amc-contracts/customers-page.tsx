"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import { LIFECYCLE_LABELS } from "@/lib/amc/client-profile";
import { ActionDialogContent, ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type CustomerInput } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcSectionNav } from "./amc-section-nav";
import { CustomerFields, cleanCustomer } from "./customer-pickers";
import { useAmcData } from "./use-amc-data";
import { LIFECYCLE_TONE } from "./profile/identity-card";

type LifecycleFilter = "all" | "prospect" | "client" | "former";

/** Shared customer records: search, open, add. */
export function CustomersPage() {
  useBreadcrumbLabel("customers", "Customers");
  const router = useRouter();
  const [q, setQ] = useState("");
  const term = useDebounce(q.trim(), 250);
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("all");
  const { data, error, loading, reload } = useAmcData(
    () => amcContractsService.customers(term, lifecycle === "all" ? null : lifecycle),
    `customers|${term}|${lifecycle}`,
  );
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="AMC contracts"
        title="Customers"
        description="One record per real customer and property. Contracts keep what was signed; these records say who they are today."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            New customer
          </Button>
        }
      />
      <AmcSectionNav current="customers" />
      <PillTabs<LifecycleFilter>
        value={lifecycle}
        onChange={setLifecycle}
        tabs={[
          { value: "all", label: "All" },
          { value: "prospect", label: "Prospects" },
          { value: "client", label: "Clients" },
          { value: "former", label: "Former clients" },
        ]}
      />
      <SectionCard
        title="Customers"
        icon={<Users />}
        bodyClassName="pb-2"
        action={<Input className="h-8 w-56" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />}
      >
        {error ? (
          <div className="px-5 pb-4">
            <ErrorState title="Could not load customers" message={error} onRetry={reload} />
          </div>
        ) : loading ? (
          <div className="px-5 pb-4">
            <ListSkeleton rows={5} />
          </div>
        ) : data!.customers.length === 0 ? (
          <p className="text-muted-foreground px-5 pb-4 text-sm">
            {term ? "No customers match." : "No customer records yet. Link one from a contract, or add one here."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Customer ID</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="pr-5">Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.customers.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/extensions/amc-contracts/customers/${c.id}`)}>
                    <TableCell className="pl-5 font-medium">
                      <Link href={`/extensions/amc-contracts/customers/${c.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                      {c.company ? <div className="text-muted-foreground text-xs">{c.company}</div> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`border-none ${LIFECYCLE_TONE[c.lifecycle]}`}>
                        {LIFECYCLE_LABELS[c.lifecycle]}
                      </Badge>
                    </TableCell>
                    <TableCell>{c.customerRef ?? "—"}</TableCell>
                    <TableCell>{c.phone ?? "—"}</TableCell>
                    <TableCell className="pr-5">{c.email ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
      {adding ? (
        <CustomerDialog
          title="New customer"
          initial={{ name: "", lifecycle: "client" }}
          onOpenChange={(next) => !next && setAdding(false)}
          onSave={async (input) => {
            const { customer } = await amcContractsService.createCustomer(input);
            toast.success("Customer added");
            router.push(`/extensions/amc-contracts/customers/${customer.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

export function CustomerDialog({
  title,
  initial,
  onOpenChange,
  onSave,
}: {
  title: string;
  initial: CustomerInput;
  onOpenChange: (open: boolean) => void;
  onSave: (input: CustomerInput) => Promise<void>;
}) {
  const [value, setValue] = useState<CustomerInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(cleanCustomer(value));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Signed contracts keep their own copy of these details.</DialogDescription>
        </DialogHeader>
        <CustomerFields value={value} onChange={setValue} />
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !value.name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
