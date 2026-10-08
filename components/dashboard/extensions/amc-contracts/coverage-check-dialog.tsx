"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { useDebounce } from "@/hooks/use-debounce";
import { formatQuantity, todayInDubai, unitWord, type AmcCoverageStatus } from "@/lib/amc/contracts";
import {
  amcContractsService,
  type ContractListRow,
  type CoverageCatalogueItem,
  type CoverageCheckResponse,
} from "@/modules/amc-contracts/amc-contracts-service";

import { formatContractDate } from "./contract-status";

const AMC_STATUS_LABELS: Record<AmcCoverageStatus, string> = {
  active: "Active",
  not_started: "Not started",
  expired: "Expired",
  cancelled: "Cancelled",
  none: "None",
};

const VERDICT_TONES = {
  covered_by_amc: "bg-success/10 text-success",
  chargeable: "bg-warning/10 text-warning",
  no_active_amc: "bg-danger/10 text-danger",
} as const;

const VERDICT_LABELS = {
  covered_by_amc: "COVERED BY AMC",
  chargeable: "CHARGEABLE",
  no_active_amc: "NO ACTIVE AMC",
} as const;

type RequestType = "planned" | "emergency" | "non_emergency";

/**
 * "Is this covered?" for staff taking a request. Asks for the customer (or
 * a contract), what is needed and when, and answers with the AMC's state,
 * whether the service is on it, what is left, and the verdict. Read-only:
 * it never records usage or creates work orders.
 */
export function CoverageCheckDialog({
  open,
  onOpenChange,
  contract,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from a contract page: check against that contract. */
  contract?: { id: string; proposalNumber: string; customerName: string };
}) {
  const [catalogue, setCatalogue] = useState<CoverageCatalogueItem[]>([]);
  const [lookup, setLookup] = useState<"customer" | "contract">("customer");
  const [customerRef, setCustomerRef] = useState("");
  const [contractSearch, setContractSearch] = useState("");
  const [matches, setMatches] = useState<ContractListRow[]>([]);
  const [picked, setPicked] = useState<ContractListRow | null>(null);
  const [requestType, setRequestType] = useState<RequestType>("planned");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(todayInDubai());
  const [result, setResult] = useState<CoverageCheckResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useDebounce(contractSearch.trim(), 300);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDate(todayInDubai());
    amcContractsService.coverageCatalogue().then(
      ({ catalogue: items }) => setCatalogue(items),
      (e) => toast.error(e instanceof Error ? e.message : "Could not load the services."),
    );
  }, [open]);

  /* Contract search for the "Contract" lookup. */
  useEffect(() => {
    if (contract || lookup !== "contract" || !search) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    amcContractsService
      .list({ status: "all", search, page: 0, pageSize: 8 })
      .then((r) => !cancelled && setMatches(r.rows.filter((row) => row.kind === "contract")))
      .catch(() => !cancelled && setMatches([]));
    return () => {
      cancelled = true;
    };
  }, [search, lookup, contract]);

  const planned = catalogue.filter((s) => !s.callOutClass);
  const callOutService =
    requestType === "planned" ? null : catalogue.find((s) => s.callOutClass === requestType) ?? null;
  const effectiveServiceId = requestType === "planned" ? serviceId : callOutService?.id ?? "";
  const target = contract ? { contractId: contract.id } : lookup === "contract" ? (picked ? { contractId: picked.id } : null) : customerRef.trim() ? { customerRef: customerRef.trim() } : null;

  const check = async () => {
    if (!target || !effectiveServiceId) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await amcContractsService.coverage({ ...target, serviceId: effectiveServiceId, date }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check coverage.");
    } finally {
      setBusy(false);
    }
  };

  const c = result?.coverage;
  const entitlementLine = !c
    ? "—"
    : c.outcome === "no_contract" || c.outcome === "not_covered"
      ? "—"
      : c.unlimited
        ? `Unlimited · ${formatQuantity(c.used ?? 0)} used so far`
        : c.entitlementType === "informational"
          ? "Included, not counted"
          : `${formatQuantity(c.included ?? 0)} included · ${formatQuantity(c.used ?? 0)} used · ${formatQuantity(c.remaining ?? 0)} ${unitWord(c.entitlementType ?? "visits", c.remaining ?? 0)} remaining`;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check AMC coverage</DialogTitle>
          <DialogDescription>
            {contract
              ? `Checks a request against AMC ${contract.proposalNumber} (${contract.customerName || "client"}). Nothing is recorded.`
              : "Find out whether a request is covered by the client's AMC. Nothing is recorded."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {!contract ? (
            <div className="grid gap-2">
              <Tabs
                value={lookup}
                onValueChange={(value) => {
                  setLookup(value as typeof lookup);
                  setResult(null);
                }}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="customer">By client ID</TabsTrigger>
                  <TabsTrigger value="contract">By contract</TabsTrigger>
                </TabsList>
              </Tabs>
              {lookup === "customer" ? (
                <div className="grid gap-2">
                  <Label htmlFor="amc-cov-customer">Client ID</Label>
                  <Input
                    id="amc-cov-customer"
                    placeholder="e.g. YFI1806"
                    value={customerRef}
                    maxLength={100}
                    onChange={(event) => setCustomerRef(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">The Client ID on the AMC proposal.</p>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="amc-cov-contract">Contract</Label>
                  <Input
                    id="amc-cov-contract"
                    placeholder="Search by client, property or contract number"
                    value={contractSearch}
                    onChange={(event) => {
                      setContractSearch(event.target.value);
                      setPicked(null);
                    }}
                  />
                  {picked ? (
                    <p className="text-sm">
                      Selected: <span className="font-medium">{picked.proposalNumber}</span> · {picked.customerName}
                    </p>
                  ) : matches.length > 0 ? (
                    <ul className="divide-y rounded-lg border text-sm">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            className="hover:bg-muted w-full px-3 py-2 text-left"
                            onClick={() => setPicked(m)}
                          >
                            <span className="font-medium">{m.proposalNumber}</span> · {m.customerName}
                            <span className="text-muted-foreground block truncate text-xs">{m.propertyLabel}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : search ? (
                    <p className="text-muted-foreground text-xs">No contracts match.</p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="amc-cov-type">Request</Label>
              <Select value={requestType} onValueChange={(value) => setRequestType(value as RequestType)}>
                <SelectTrigger id="amc-cov-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned service</SelectItem>
                  <SelectItem value="emergency">Emergency call-out</SelectItem>
                  <SelectItem value="non_emergency">Non-emergency call-out</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amc-cov-date">Date of the work</Label>
              <DatePickerField id="amc-cov-date" value={date} onChange={setDate} />
            </div>
          </div>

          {requestType === "planned" ? (
            <div className="grid gap-2">
              <Label htmlFor="amc-cov-service">Service</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger id="amc-cov-service">
                  <SelectValue placeholder="Choose a service" />
                </SelectTrigger>
                <SelectContent>
                  {planned.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : !callOutService ? (
            <p className="text-muted-foreground text-sm">The AMC catalogue has no service for this kind of call-out.</p>
          ) : null}

          {result && c ? (
            <div className="grid gap-3 rounded-lg border p-4" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="secondary" className={`border-0 px-2.5 py-1 text-sm font-semibold ${VERDICT_TONES[result.verdict.verdict]}`}>
                  {VERDICT_LABELS[result.verdict.verdict]}
                </Badge>
                <span className="text-muted-foreground text-xs">On {formatContractDate(result.date)}</span>
              </div>
              <dl className="grid gap-2 text-sm">
                <Line label="AMC status" value={AMC_STATUS_LABELS[c.amcStatus]} />
                <Line
                  label="Service"
                  value={c.outcome === "no_contract" ? "—" : c.outcome === "not_covered" ? "Not covered" : "Covered"}
                />
                <Line label="Entitlement" value={entitlementLine} />
              </dl>
              <p className="text-muted-foreground text-sm">{c.reason}</p>
              {result.sla ? (
                <p className="bg-muted/40 rounded-md px-3 py-2 text-xs">
                  Service level target: {result.sla.label}. Whether it is met is unknown: the portal does
                  not receive request and arrival times from FSM yet.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          <SubmitButton
            onClick={() => void check()}
            disabled={!target || !effectiveServiceId || !date}
            pending={busy}
            pendingLabel="Checking…"
            icon={<ShieldCheck className="size-4" />}
          >
            Check coverage
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
