"use client";

import { useState } from "react";
import { Boxes, Minus, SquarePen, Plus, Undo2, Wrench } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MONTHS } from "@/lib/amc/client-profile";
import type { SiteAsset, SiteChangeView, SiteScopeItem } from "@/lib/server/amc/site-visit-approval";
import { cn } from "@/lib/utils";

type Fields = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === "number" ? v : null);

const OP = {
  insert: { label: "Added", icon: <Plus />, tone: "bg-success/10 text-success" },
  update: { label: "Changed", icon: <SquarePen />, tone: "bg-brand-50 text-brand" },
  delete: { label: "Removed", icon: <Minus />, tone: "bg-danger/10 text-danger" },
} as const;

/** One asset in a line: "Split AC × 3 · Living room · Daikin". */
const assetLine = (f: Fields | null) =>
  f ? [`${s(f.assetType) ?? "Asset"}${n(f.quantity) && n(f.quantity)! > 1 ? ` × ${n(f.quantity)}` : ""}`, s(f.location), [s(f.make), s(f.model)].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "";

/** One scope item in a line: "AC PPM × 3 · 4 visits a year". */
const scopeLine = (f: Fields | null, serviceLabel: (id: string) => string) =>
  f
    ? [
        `${serviceLabel(String(f.serviceId ?? ""))}${n(f.quantity) && n(f.quantity)! > 1 ? ` × ${n(f.quantity)}` : ""}`,
        n(f.frequencyPerYear) ? `${n(f.frequencyPerYear)} visit${n(f.frequencyPerYear) === 1 ? "" : "s"} a year` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

/**
 * What the site visit will change on the property (16 Nov 2026): the scope
 * and assets the inspector added, changed or removed on the mobile app,
 * held until the approver approves. A change shows what it was and what it
 * will be.
 */
export function SiteVisitChangesCard({
  changes,
  serviceLabel,
  approved,
  approverName,
}: {
  changes: SiteChangeView[];
  serviceLabel: (serviceId: string) => string;
  approved: boolean;
  approverName: string | null;
}) {
  const line = (c: SiteChangeView, f: Fields | null) => (c.entity === "asset" ? assetLine(f) : scopeLine(f, serviceLabel));
  const groups = [
    { key: "scope", title: "Scope of works", icon: <Wrench className="size-4" />, rows: changes.filter((c) => c.entity === "scope") },
    { key: "asset", title: "Assets", icon: <Boxes className="size-4" />, rows: changes.filter((c) => c.entity === "asset") },
  ].filter((g) => g.rows.length);

  return (
    <SectionCard
      title="Changes to the property"
      icon={<Boxes />}
      description={
        approved
          ? "Applied to the property when the visit was approved."
          : `Recorded by the inspector on site. They go onto the property when ${approverName ?? "the approver"} approves the visit.`
      }
      bodyClassName="px-5 pb-4"
      action={changes.length ? <Badge variant="secondary">{changes.length}</Badge> : undefined}
    >
      {changes.length === 0 ? (
        <div className="rounded-lg border border-dashed">
          <EmptyState icon={<Boxes className="size-5" />} title="No changes to the property yet" description="The scope and asset changes the inspector makes on site show here as their phone syncs." />
        </div>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <div key={g.key} className="grid gap-2">
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                {g.icon}
                {g.title}
              </p>
              <ul className="divide-y rounded-lg border">
                {g.rows.map((c) => {
                  const op = OP[c.op];
                  const before = c.before as unknown as Fields | null;
                  return (
                    <li key={`${c.entity}:${c.targetId}`} className="flex items-start gap-3 px-3 py-2.5">
                      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5", op.tone)} aria-hidden>
                        {op.icon}
                      </span>
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-medium">{line(c, c.op === "delete" ? before : c.after) || "—"}</span>
                        {c.op === "update" && before ? <span className="text-muted-foreground block text-xs">Was: {line(c, before)}</span> : null}
                        {c.op === "delete" ? <span className="text-muted-foreground block text-xs">Taken off the property</span> : null}
                      </span>
                      <Badge variant="secondary" className={cn("shrink-0 border-0 font-medium", op.tone)}>
                        {op.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** The approver sends the visit back to the inspector, saying what to change. */
export function SendBackDialog({
  open,
  onOpenChange,
  inspectorName,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspectorName: string | null;
  onSend: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await onSend(reason.trim());
      setReason("");
      onOpenChange(false);
    } catch (e) {
      /* Stays open with the note, to try again. */
      toast.error(e instanceof Error ? e.message : "Could not send the site visit back.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send the site visit back?</DialogTitle>
          <DialogDescription>
            It reopens on {inspectorName ?? "the inspector"}&apos;s phone with your note, so they can put it right and complete it again. Nothing goes onto the property until you approve.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="send-back-reason">What should they change?</Label>
          <Textarea id="send-back-reason" rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Count the AC units again: the living room has two, not three." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void send()} pending={busy} pendingLabel="Sending back…" disabled={reason.trim().length < 3} icon={<Undo2 className="size-4" />}>
            Send back
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Scope and assets, as the inspector left them (16 Nov 2026)          */
/* ------------------------------------------------------------------ */

const CHANGE_LABEL = { insert: "Added on site", update: "Changed on site", delete: "Removed on site" } as const;
const CONDITION_LABEL: Record<string, string> = { good: "Good", fair: "Fair", poor: "Poor", critical: "Critical", unknown: "Condition unknown" };

function ChangeBadge({ change }: { change: "insert" | "update" | "delete" | null }) {
  if (!change) return null;
  return (
    <Badge variant="secondary" className={cn("shrink-0 border-0 font-medium", OP[change].tone)}>
      {CHANGE_LABEL[change]}
    </Badge>
  );
}

/**
 * The property's scope of works and assets as the inspector recorded them
 * on the mobile app: what the property has, with this visit's changes in
 * place and marked. Until the approver approves, the marked rows are not on
 * the property yet; a removed one stays here, struck through.
 */
export function SiteVisitPropertyLists({
  assets,
  scope,
  serviceLabel,
  pendingFor,
}: {
  assets: Array<SiteAsset>;
  scope: Array<SiteScopeItem>;
  serviceLabel: (serviceId: string) => string;
  /** The approver's name while the marked changes wait for them; null once applied (or with nothing to approve). */
  pendingFor: string | null;
}) {
  const assetName = (id: string | null) => {
    const x = id ? assets.find((a) => a.id === id) : undefined;
    return x ? `${x.assetType}${x.location ? ` (${x.location})` : ""}` : null;
  };
  const marked = [...assets, ...scope].filter((x) => x.change).length;
  const note = pendingFor && marked ? ` Marked rows go onto the property when ${pendingFor} approves.` : "";
  const rowClass = (change: string | null) => cn("flex items-start gap-3 px-3 py-2.5", change === "delete" && "opacity-60");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard
        title="Scope of works"
        icon={<Wrench />}
        description={`The services the property gets, with units and visits a year, as the inspector recorded them on site.${note}`}
        bodyClassName="px-5 pb-4"
        action={scope.length ? <Badge variant="secondary">{scope.filter((x) => x.change !== "delete").length}</Badge> : undefined}
      >
        {scope.length === 0 ? (
          /* The same empty box as the other cards (16 Nov 2026). */
          <div className="rounded-lg border border-dashed">
            <EmptyState icon={<Wrench className="size-5" />} title="No scope of works yet" description="The services the property gets show here once the inspector records them on the mobile app." />
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {scope.map((x) => {
              const linked = assetName(x.assetId);
              return (
                <li key={x.id} className={rowClass(x.change)}>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className={cn("block font-medium", x.change === "delete" && "line-through")}>
                      {serviceLabel(x.serviceId)}
                      {x.quantity > 1 ? ` × ${x.quantity}` : ""}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {[
                        x.frequencyPerYear ? `${x.frequencyPerYear} visit${x.frequencyPerYear === 1 ? "" : "s"} a year` : null,
                        x.durationMinutes ? `${x.durationMinutes} min each` : null,
                        x.preferredMonths.length ? `In ${x.preferredMonths.map((m) => MONTHS[m - 1]).join(", ")}` : null,
                        linked ? `For ${linked}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                    {x.exclusions ? <span className="text-muted-foreground block text-xs">Excludes: {x.exclusions}</span> : null}
                    {x.notes ? <span className="text-muted-foreground block text-xs">{x.notes}</span> : null}
                  </span>
                  <ChangeBadge change={x.change} />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Assets"
        icon={<Boxes />}
        description={`The equipment on the property, counted and described on site.${note}`}
        bodyClassName="px-5 pb-4"
        action={assets.length ? <Badge variant="secondary">{assets.filter((x) => x.change !== "delete").reduce((n, x) => n + x.quantity, 0)}</Badge> : undefined}
      >
        {assets.length === 0 ? (
          <div className="rounded-lg border border-dashed">
            <EmptyState icon={<Boxes className="size-5" />} title="No assets yet" description="The equipment the inspector counts on site (AC units, pumps, heaters) shows here once their phone syncs." />
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {assets.map((x) => (
              <li key={x.id} className={rowClass(x.change)}>
                <span className="min-w-0 flex-1 text-sm">
                  <span className={cn("block font-medium", x.change === "delete" && "line-through")}>
                    {x.assetType}
                    {x.quantity > 1 ? ` × ${x.quantity}` : ""}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {[x.location, [x.make, x.model].filter(Boolean).join(" ") || null, x.capacity, CONDITION_LABEL[x.condition] ?? x.condition].filter(Boolean).join(" · ")}
                  </span>
                  {x.serialNo || x.installedOn ? (
                    <span className="text-muted-foreground block text-xs">
                      {[x.serialNo ? `Serial ${x.serialNo}` : null, x.installedOn ? `Installed ${x.installedOn}` : null].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  {x.notes ? <span className="text-muted-foreground block text-xs">{x.notes}</span> : null}
                </span>
                <ChangeBadge change={x.change} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
