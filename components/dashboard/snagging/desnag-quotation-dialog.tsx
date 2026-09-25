"use client";

import { Money } from "@/components/ui/money";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  snaggingService,
  type SnaggingPricingConfig,
  type SnaggingQuotationSummary,
} from "@/modules/snagging";
import { useDebounce } from "@/hooks/use-debounce";
import type { SnaggingTaskSummary } from "@/types/types";

import { PROPERTY_TYPE_LABELS, SubmitButton } from "./shared";

/** The job being returned to, when the caller already knows it. */
type SourceJob = { id: string; label: string; property_type: string | null };

/**
 * Raises a de-snag quotation (BA v2, change 31), at a price the coordinator
 * chooses inside the rate card's de-snagging range.
 *
 * The card publishes de-snagging as a range for each property type -- an
 * apartment is 500 to 750 -- and the quotation used to be raised at the
 * bottom of it without asking. The amount is now entered here, held
 * inside the range the same way the job wizard holds a rate inside its
 * band; a card with one figure shows it rather than asking for it, and
 * a type with no price says so before anything is raised.
 *
 * Opened from the Quotations page, where the inspection is chosen, and
 * from a job's own page, where it is already known.
 */
export function DesnagQuotationDialog({
  open,
  onOpenChange,
  sourceJob,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed from a job's page; absent on the Quotations page, which asks. */
  sourceJob?: SourceJob;
  onCreated: (quote: SnaggingQuotationSummary) => void;
}) {
  const [jobs, setJobs] = useState<SnaggingTaskSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobId, setJobId] = useState("");
  const [pricing, setPricing] = useState<SnaggingPricingConfig | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  // A fresh dialog each time it opens.
  const [seeded, setSeeded] = useState(false);
  if (open !== seeded) {
    setSeeded(open);
    if (open) {
      setJobId(sourceJob?.id ?? "");
      setAmount("");
      if (!sourceJob) setJobsLoading(true);
    }
  }

  useEffect(() => {
    if (!open || pricing) return;
    let live = true;
    snaggingService
      .getPricing()
      .then((config) => {
        if (live) setPricing(config);
      })
      .catch((error: unknown) => {
        if (live) {
          setPricingError(error instanceof Error ? error.message : "Could not load the rate card");
        }
      });
    return () => {
      live = false;
    };
  }, [open, pricing]);

  /*
    Finished inspections, searched on the server by code, unit or
    building. Only the first 200 used to load, so older jobs could never
    be picked for a de-snag.
  */
  const [jobSearch, setJobSearch] = useState("");
  const debouncedJobSearch = useDebounce(jobSearch.trim(), 300);
  // The picked job, kept even when a new search leaves it off the list.
  const [pickedJob, setPickedJob] = useState<SnaggingTaskSummary | null>(null);

  useEffect(() => {
    if (!open || sourceJob) return;
    let live = true;
    setJobsLoading(true);
    snaggingService
      .listTasks(
        { status: "approved,delivered", search: debouncedJobSearch || undefined },
        0,
        25,
      )
      .then((res) => {
        if (live) setJobs(res.data ?? []);
      })
      .catch(() => {
        if (live) setJobs([]);
      })
      .finally(() => {
        if (live) setJobsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, sourceJob, debouncedJobSearch]);

  // The picked job stays in the list whatever the search shows.
  const jobOptions =
    pickedJob && !jobs.some((job) => job.id === pickedJob.id) ? [pickedJob, ...jobs] : jobs;

  // Which property type is being priced: the job passed in, or the one picked.
  const propertyType = sourceJob
    ? sourceJob.property_type
    : (jobOptions.find((job) => job.id === jobId)?.property_type ?? null);
  const chosenJob = sourceJob?.id ?? jobId;

  /*
    The card's range for this type. Unknown types fall back to the
    apartment row, as the server does, so the two never disagree.
  */
  const range = useMemo(() => {
    const types = pricing?.rate_card?.types;
    if (!types || !chosenJob) return null;
    const row = types[propertyType ?? "apartment"] ?? types.apartment;
    if (!row || row.desnag_min == null) return { kind: "none" as const };
    const max = row.desnag_max ?? row.desnag_min;
    return row.desnag_min === max
      ? { kind: "fixed" as const, value: row.desnag_min }
      : { kind: "band" as const, min: row.desnag_min, max };
  }, [pricing, propertyType, chosenJob]);

  const currency = pricing?.currency ?? "AED";
  const typeLabel = PROPERTY_TYPE_LABELS[propertyType ?? "apartment"] ?? propertyType ?? "property";
  const entered = Number(amount);
  const amountValid =
    range?.kind === "fixed" ||
    (range?.kind === "band" &&
      amount.trim() !== "" &&
      Number.isFinite(entered) &&
      entered >= range.min &&
      entered <= range.max);

  async function create() {
    if (!chosenJob || !range || range.kind === "none" || !amountValid) return;
    setSaving(true);
    try {
      const quote = await snaggingService.createDesnagQuotation(
        chosenJob,
        range.kind === "band" ? entered : range.value,
      );
      toast.success(`De-snag quotation ${quote.quote_number} raised`, {
        description: "Send it to the client. Open the de-snag once they approve it.",
      });
      onCreated(quote);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not raise the quotation");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quote a de-snagging visit</DialogTitle>
          <DialogDescription>
            {sourceJob
              ? `A return visit to ${sourceJob.label} to verify the fixes. Once the client approves it, the de-snag opens as a new job with the open defects carried across.`
              : "A return visit to verify fixes. The client and unit come from the original inspection; once they approve, the de-snag opens as a new job with the open defects carried across."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {sourceJob ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="desnag-job">Which inspection?</Label>
              <Input
                id="desnag-job-search"
                value={jobSearch}
                onChange={(event) => setJobSearch(event.target.value)}
                placeholder="Search by job code, unit or building"
                aria-label="Search finished inspections"
              />
              <Select
                value={jobId}
                onValueChange={(value) => {
                  setJobId(value);
                  setPickedJob(jobOptions.find((job) => job.id === value) ?? null);
                  setAmount("");
                }}
              >
                <SelectTrigger id="desnag-job" className="w-full">
                  <SelectValue
                    placeholder={
                      jobsLoading
                        ? "Loading finished inspections…"
                        : "Pick the inspection to return to"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {jobOptions.length === 0 ? (
                    <div className="text-muted-foreground px-2 py-1.5 text-sm">
                      {jobsLoading
                        ? "Loading…"
                        : debouncedJobSearch
                          ? "No finished inspection matches that"
                          : "No finished inspections yet"}
                    </div>
                  ) : (
                    jobOptions.map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {/*
                          The unit, not the job code. This list is read to
                          answer "which property are we going back to",
                          and the code led every row with a string that
                          answers nothing.
                        */}
                        {job.unit_label}
                        {job.building_name ? `, ${job.building_name}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {pricingError ? (
            <p className="text-destructive text-sm">{pricingError}</p>
          ) : !chosenJob ? null : !range ? (
            <p className="text-muted-foreground text-sm">Loading the rate card…</p>
          ) : range.kind === "none" ? (
            <Alert variant="destructive">
              <AlertTitle>No de-snagging price for a {typeLabel.toLowerCase()}</AlertTitle>
              <AlertDescription>
                The rate card has none for this property type. Set one on the Pricing page first.
              </AlertDescription>
            </Alert>
          ) : range.kind === "fixed" ? (
            <div className="space-y-1.5">
              <Label>De-snagging amount</Label>
              <div className="bg-muted/50 text-muted-foreground flex h-9 items-center rounded-md border px-3 text-sm">
                <span className="text-foreground font-medium tabular-nums">
                  <Money value={range.value} currency={currency} dp={0} />
                </span>
                <span className="ml-2 text-xs">+ VAT · published rate for a {typeLabel.toLowerCase()}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="desnag-amount">De-snagging amount (before VAT)</Label>
              <AmountInBand
                id="desnag-amount"
                band={range}
                value={amount}
                onChange={setAmount}
              />
              <p className="text-muted-foreground text-xs">
                Between <Money value={range.min} currency={currency} dp={0} /> and{" "}
                <Money value={range.max} currency={currency} dp={0} /> for a{" "}
                {typeLabel.toLowerCase()}, from the rate card.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void create()}
            pending={saving}
            pendingLabel="Raising…"
            disabled={!chosenJob || !amountValid}
          >
            Raise quotation
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const AMOUNT_STEP = 10;

/**
 * Could this half-typed amount still grow into the band?
 *
 * The wizard's rate field judges a keystroke the same way, but for rates
 * of a few dirhams a square foot. An amount is typed in hundreds, so on
 * the way to "500" the field must take "5" and "50": the question is
 * whether ANY number starting with what has been typed lands in the
 * band, allowing for more whole digits as well as decimals.
 */
function canReachAmount(partial: string, band: { min: number; max: number }) {
  if (partial === "") return true;
  if (!/^\d*\.?\d{0,2}$/.test(partial)) return false;
  const EPS = 1e-9;
  const dot = partial.indexOf(".");
  if (dot !== -1) {
    const lower = Number(partial === "." ? "0" : partial);
    const span = Math.pow(10, -(partial.length - dot - 1));
    return lower <= band.max + EPS && lower + span > band.min + EPS;
  }
  const whole = Number(partial);
  // "5" can become 5, 50..59, 500..599, and so on up to the band's size.
  for (let scale = 1; whole * scale <= band.max + EPS; scale *= 10) {
    const lower = whole * scale;
    const upper = (whole + 1) * scale;
    if (lower <= band.max + EPS && upper > band.min + EPS) return true;
    if (whole === 0) break;
  }
  return false;
}

/**
 * An amount that cannot leave its band: a keystroke that could never land
 * inside it is refused, the arrow keys stop at each end, and a value left
 * outside on blur is clamped in.
 */
function AmountInBand({
  id,
  band,
  value,
  onChange,
}: {
  id: string;
  band: { min: number; max: number };
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      placeholder={`${band.min.toLocaleString()} – ${band.max.toLocaleString()}`}
      onChange={(e) => {
        const next = e.target.value;
        if (!canReachAmount(next, band)) return;
        onChange(next);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const current = Number(value);
        const from = value.trim() !== "" && Number.isFinite(current) ? current : band.min;
        const next = from + (e.key === "ArrowUp" ? AMOUNT_STEP : -AMOUNT_STEP);
        onChange(String(Math.min(band.max, Math.max(band.min, next))));
      }}
      onBlur={(e) => {
        const trimmed = e.target.value.trim().replace(/\.$/, "");
        if (trimmed === "") return;
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return;
        const held = Math.min(band.max, Math.max(band.min, n));
        if (String(held) !== e.target.value) onChange(String(held));
      }}
    />
  );
}
