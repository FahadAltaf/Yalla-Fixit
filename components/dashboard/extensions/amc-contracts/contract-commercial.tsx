"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Plus, Receipt, Save, SearchCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataRow, SectionCard, SubHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { todayInDubai } from "@/lib/amc/contracts";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import {
  amcContractsService,
  type AdditionalServiceEligibility,
  type AdditionalServiceRequest,
  type CommercialHistory,
  type ContractDetail,
  type QuoteRecord,
} from "@/modules/amc-contracts/amc-contracts-service";

import { formatContractDate } from "./contract-status";

type Entitlement = ContractDetail["entitlements"][number];

export const ELIGIBILITY_LABELS: Record<AdditionalServiceEligibility["outcome"], string> = {
  included_in_amc: "Included in AMC",
  amc_discount_eligible: "AMC discount",
  standard_charge: "Standard charge",
  not_configured: "No discount configured",
};

const QUOTE_STATUS: Record<QuoteRecord["status"], string> = {
  draft: "Draft: estimate not linked",
  estimate_linked: "FSM estimate linked",
  cancelled: "Cancelled",
};

const QUOTE_TONE: Record<QuoteRecord["status"], string> = {
  draft: "bg-warning/10 text-warning",
  estimate_linked: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft",
};

const aed = (n: number) => `AED ${n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The figures, always in full: standard, discount, saving, final. Nothing is hidden. */
export function DiscountBreakdown({ standard, percent, amount, final }: { standard: number | null; percent: number; amount: number; final: number | null }) {
  if (standard === null) return <p className="text-muted-foreground text-sm">Enter the standard price to see the figures.</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Standard price</dt>
      <dd className="text-right tabular-nums">{aed(standard)}</dd>
      <dt className="text-muted-foreground">AMC discount</dt>
      <dd className="text-right tabular-nums">{percent > 0 ? `${percent}%` : "None"}</dd>
      <dt className="text-muted-foreground">Client saves</dt>
      <dd className="text-right tabular-nums">{aed(amount)}</dd>
      <dt className="font-medium">Final price</dt>
      <dd className="text-right font-medium tabular-nums">{final === null ? "—" : aed(final)}</dd>
    </dl>
  );
}

/**
 * The contract's commercial relationships, and additional-service quotes
 * raised from it. A quote records the eligibility and the calculation as
 * computed; the estimate itself is created in Zoho FSM (the existing
 * quotation workflow) and linked here. Nothing is sent from the portal.
 */
export function ContractCommercial({
  contract,
  entitlements,
  canManage,
}: {
  contract: ContractDetail["contract"];
  entitlements: Entitlement[];
  canManage: boolean;
}) {
  const [data, setData] = useState<CommercialHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /* Kept after the dialog closes, so it can animate out with its content. */
  const [acting, setActing] = useState<{ quote: QuoteRecord; action: "link_estimate" | "cancel" } | null>(null);
  const [actingOpen, setActingOpen] = useState(false);
  const act = (quote: QuoteRecord, action: "link_estimate" | "cancel") => {
    setActing({ quote, action });
    setActingOpen(true);
  };

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let stale = false;
    amcContractsService.commercial(contract.id).then(
      ({ commercial }) => !stale && setData(commercial),
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not load the commercial history."),
    );
    return () => {
      stale = true;
    };
  }, [contract.id, version]);

  return (
    <SectionCard
      title="Commercial history"
      icon={<Receipt />}
      bodyClassName="px-5 pb-5 space-y-3"
      action={
        canManage && contract.status === "active" ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Additional service
          </Button>
        ) : null
      }
    >
      {error ? (
        <ErrorState
          title="Could not load the commercial history"
          message={error}
          onRetry={() => {
            setError(null);
            load();
          }}
        />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          {data.originalProposal ? (
            <DataRow
              title={
                <Link href={`/extensions/amc/${data.originalProposal.id}`} className="hover:underline">
                  Proposal {data.originalProposal.proposalNumber}
                </Link>
              }
              subtitle={data.originalProposal.signedAt ? `Signed ${formatContractDate(data.originalProposal.signedAt.slice(0, 10))}` : "Original proposal"}
              trailing={<Money value={data.contractValue} className="text-sm" />}
            />
          ) : null}
          {data.renewalProposal ? (
            <DataRow
              title={
                <Link href={`/extensions/amc/${data.renewalProposal.id}`} className="hover:underline">
                  Renewal proposal {data.renewalProposal.proposalNumber}
                </Link>
              }
              subtitle={data.renewalProposal.status.replace(/_/g, " ")}
            />
          ) : null}
          <SubHeading>Additional-service quotes</SubHeading>
          {data.quotes.length === 0 ? (
            <p className="text-muted-foreground text-sm">None yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.quotes.map((q) => (
                <li key={q.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {q.quoteNumber} · {q.serviceLabel}
                    </span>
                    <Badge variant="secondary" className={`border-0 font-medium ${QUOTE_TONE[q.status]}`}>
                      {QUOTE_STATUS[q.status]}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {ELIGIBILITY_LABELS[q.eligibility]} · for {formatContractDate(q.requestedFor)}
                    {q.fsmEstimateNumber ? ` · Estimate ${q.fsmEstimateNumber}` : ""}
                    {q.createdBy ? ` · by ${q.createdBy}` : ""}
                  </div>
                  <div className="text-xs tabular-nums">
                    {q.standardPrice !== null ? aed(q.standardPrice) : "—"}
                    {q.discountPercent > 0 ? ` − ${q.discountPercent}% (${aed(q.discountAmount)})` : ""} → {q.finalPrice !== null ? aed(q.finalPrice) : "—"}
                  </div>
                  {canManage && q.status !== "cancelled" ? (
                    <div className="flex gap-1">
                      {q.status === "draft" ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => act(q, "link_estimate")}>
                          Link FSM estimate
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => act(q, "cancel")}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">
            Discounts offered on issued quotes: {aed(data.totals.discountsOffered)} ({data.totals.issued} issued, {data.totals.drafts} draft). Drafts and
            cancelled quotes are not counted; acceptance is recorded in FSM.
          </p>
        </>
      )}

      <AdditionalServiceDialog
        open={adding}
        onOpenChange={setAdding}
        contractId={contract.id}
        entitlements={entitlements}
        onSaved={() => {
          setAdding(false);
          void load();
        }}
      />
      {acting ? (
        <QuoteActionDialog
          open={actingOpen}
          onOpenChange={setActingOpen}
          contractId={contract.id}
          quote={acting.quote}
          action={acting.action}
          onDone={() => {
            setActingOpen(false);
            void load();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

const OTHER = "__other__";

function AdditionalServiceDialog({
  open,
  onOpenChange,
  contractId,
  entitlements,
  onSaved,
}: {
  open: boolean;
  contractId: string;
  entitlements: Entitlement[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [choice, setChoice] = useState(OTHER);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(todayInDubai());
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<AdditionalServiceEligibility | null>(null);
  const [working, setWorking] = useState<"check" | "save" | null>(null);
  const busy = working !== null;

  /* Each opening starts a new quote. */
  useEffect(() => {
    if (!open) return;
    setChoice(OTHER);
    setLabel("");
    setKey("");
    setCategory("");
    setDate(todayInDubai());
    setPrice("");
    setNotes("");
    setResult(null);
  }, [open]);

  const onContract = entitlements.find((e) => e.serviceId === choice);
  const request = (): AdditionalServiceRequest => ({
    serviceKey: onContract ? onContract.serviceId : key.trim() || label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    serviceLabel: onContract ? onContract.serviceLabel : label.trim(),
    amcServiceId: onContract ? onContract.serviceId : null,
    category: category.trim() || null,
    date,
    standardPrice: price === "" ? null : Number(price),
    notes: notes.trim() || null,
  });
  const valid = (onContract || label.trim()) && date && (price === "" || Number(price) >= 0);

  const check = async () => {
    setWorking("check");
    try {
      setResult((await amcContractsService.checkAdditionalService(contractId, request())).eligibility);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check the service.");
    } finally {
      setWorking(null);
    }
  };
  const save = async () => {
    setWorking("save");
    try {
      const { quote } = await amcContractsService.createQuote(contractId, request());
      toast.success(`${quote.quoteNumber} saved. Create the estimate in Zoho FSM with these figures, then link it.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the quote.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Additional service</DialogTitle>
          <DialogDescription>Check whether it is covered or discounted, then save a quote. Nothing is sent to the client.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="aq-service">Service</Label>
            <Select
              value={choice}
              onValueChange={(v) => {
                setChoice(v);
                setResult(null);
              }}
            >
              <SelectTrigger id="aq-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OTHER}>A service not on this AMC</SelectItem>
                {entitlements.map((e) => (
                  <SelectItem key={e.serviceId} value={e.serviceId}>
                    {e.serviceLabel} (on this AMC)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!onContract ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="aq-label">Service name</Label>
                <Input id="aq-label" value={label} onChange={(e) => { setLabel(e.target.value); setResult(null); }} maxLength={200} placeholder="e.g. Interior painting" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="aq-key">Service key (optional)</Label>
                <Input id="aq-key" value={key} onChange={(e) => { setKey(e.target.value); setResult(null); }} maxLength={100} placeholder="e.g. painting" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="aq-cat">Category (optional)</Label>
                <Input id="aq-cat" value={category} onChange={(e) => { setCategory(e.target.value); setResult(null); }} maxLength={100} placeholder="e.g. plumbing" />
              </div>
              <p className="text-muted-foreground text-xs sm:col-span-2">The key and category decide whether the AMC discount applies (Settings).</p>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="aq-date">Date of the work</Label>
              <DatePickerField id="aq-date" value={date} onChange={(v) => { setDate(v); setResult(null); }} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="aq-price">Standard price (AED, excl. VAT)</Label>
              <Input id="aq-price" type="number" min={0} step="0.01" value={price} onChange={(e) => { setPrice(e.target.value); setResult(null); }} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="aq-notes">Notes (optional)</Label>
            <Textarea id="aq-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
          {result ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="font-medium">{ELIGIBILITY_LABELS[result.outcome]}</div>
              <ul className="text-muted-foreground list-disc pl-5 text-sm">
                {result.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {result.outcome !== "included_in_amc" ? (
                <DiscountBreakdown standard={result.standardPrice} percent={result.discountPercent} amount={result.discountAmount} final={result.finalPrice} />
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            variant="outline"
            onClick={() => void check()}
            disabled={busy || !valid}
            pending={working === "check"}
            pendingLabel="Checking…"
            icon={<SearchCheck className="size-4" />}
          >
            Check
          </SubmitButton>
          <SubmitButton
            onClick={() => void save()}
            disabled={busy || !valid || !result || result.outcome === "included_in_amc" || result.standardPrice === null}
            pending={working === "save"}
            pendingLabel="Saving…"
            icon={<Save className="size-4" />}
          >
            Save quote
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function QuoteActionDialog({
  open,
  onOpenChange,
  contractId,
  quote,
  action,
  onDone,
}: {
  open: boolean;
  contractId: string;
  quote: QuoteRecord;
  action: "link_estimate" | "cancel";
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue("");
  }, [open, quote.id, action]);
  const submit = async () => {
    setBusy(true);
    try {
      await amcContractsService.updateQuote(
        contractId,
        quote.id,
        action === "link_estimate" ? { action, estimateNumber: value.trim() } : { action, reason: value.trim() },
      );
      toast.success(action === "link_estimate" ? "Estimate linked" : "Quote cancelled");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the quote.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{action === "link_estimate" ? `Link the FSM estimate for ${quote.quoteNumber}` : `Cancel ${quote.quoteNumber}?`}</DialogTitle>
          <DialogDescription>
            {action === "link_estimate"
              ? "Enter the estimate number from Zoho FSM. It is checked in FSM before linking."
              : "The quote stays in the history; its figures are not counted."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {action === "link_estimate" ? (
            <>
              <DiscountBreakdown standard={quote.standardPrice} percent={quote.discountPercent} amount={quote.discountAmount} final={quote.finalPrice} />
              <div className="grid gap-2">
                <Label htmlFor="aq-estimate">Estimate number</Label>
                <Input id="aq-estimate" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. EST1043" maxLength={60} />
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="aq-cancel-reason">Reason</Label>
              <Textarea id="aq-cancel-reason" value={value} onChange={(e) => setValue(e.target.value)} rows={2} maxLength={500} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {action === "cancel" ? "Keep quote" : "Cancel"}
          </Button>
          <SubmitButton
            variant={action === "cancel" ? "destructive" : "default"}
            onClick={() => void submit()}
            disabled={value.trim().length < (action === "cancel" ? 3 : 2)}
            pending={busy}
            pendingLabel={action === "cancel" ? "Cancelling…" : "Linking…"}
            icon={action === "cancel" ? <XCircle className="size-4" /> : <Link2 className="size-4" />}
          >
            {action === "link_estimate" ? "Link estimate" : "Cancel quote"}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
