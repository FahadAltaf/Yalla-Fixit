"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type SnaggingQuotation } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTask } from "@/types/types";

import { SectionCard } from "./shared";

/**
 * Quotation for a job (F1-F6). A job starts as a draft and only reaches
 * the inspector once its quotation is approved, so this panel leads the
 * detail screen while a job is unpriced.
 */
export function QuotationPanel({
  task,
  onChanged,
}: {
  task: SnaggingTask;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const canEdit = hasResourceAction(user, ResourceType.SNAGGING, ActionType.EDIT);
  const [quote, setQuote] = useState<SnaggingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      setQuote(await snaggingService.getQuotation(task.id));
    } catch {
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: "generate" | "send" | "approve" | "reject", extra?: Record<string, unknown>) {
    if (working) return;
    setWorking(true);
    try {
      await snaggingService.quotationAction(task.id, action, extra);
      await load();
      if (action === "approve") {
        toast.success("Quotation approved — the job is now assigned");
        onChanged();
      } else if (action === "generate") {
        toast.success("Quotation generated");
      } else if (action === "send") {
        toast.success("Marked as sent");
      } else {
        toast.success("Quotation rejected");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the quotation");
    } finally {
      setWorking(false);
    }
  }

  const money = (n: number) => `${quote?.currency ?? "AED"} ${Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isApproved = quote?.status === "approved";

  return (
    <SectionCard
      title="Quotation"
      description={
        quote
          ? `${quote.quote_number} · ${quote.status}`
          : task.status === "draft"
            ? "This job is a draft. Generate and approve a quotation to assign it."
            : "No quotation on this job."
      }
      bodyClassName="border-t"
    >
      <div className="space-y-4 p-5">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : !quote ? (
          canEdit ? (
            <Button onClick={() => void run("generate")} disabled={working}>
              {working ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              Generate quotation
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">No quotation yet.</p>
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-2 font-medium">Description</th>
                    <th className="py-2 px-2 text-right font-medium">Qty</th>
                    <th className="py-2 px-2 text-right font-medium">Rate</th>
                    <th className="py-2 pl-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.lines.map((line, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-2">{line.description}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {line.qty} {line.unit}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(line.unit_price)}</td>
                      <td className="py-2 pl-2 text-right font-medium tabular-nums">{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <Row label="Subtotal" value={money(quote.subtotal)} />
              <Row label={`VAT (${quote.tax_rate}%)`} value={money(quote.tax_amount)} muted />
              <div className="flex items-center justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(quote.total)}</span>
              </div>
            </div>

            {quote.status === "rejected" && quote.rejected_reason ? (
              <p className="text-destructive text-sm">Rejected: {quote.rejected_reason}</p>
            ) : null}

            {canEdit && !isApproved ? (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => void run("generate")} disabled={working}>
                  <FileText className="size-4" /> Regenerate
                </Button>
                {quote.status !== "sent" ? (
                  <Button variant="outline" size="sm" onClick={() => void run("send")} disabled={working}>
                    <Send className="size-4" /> Mark sent
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => void run("approve")} disabled={working}>
                  <CheckCircle2 className="size-4" /> Approve &amp; assign
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const reason = window.prompt("Reason for rejecting this quotation?") ?? "";
                    if (reason.trim()) void run("reject", { reason: reason.trim() });
                  }}
                  disabled={working}
                >
                  <XCircle className="size-4" /> Reject
                </Button>
              </div>
            ) : isApproved ? (
              <Badge variant="secondary" className="bg-success/10 text-success border-0">
                <CheckCircle2 className="mr-1 size-3.5" /> Approved
              </Badge>
            ) : null}
          </>
        )}
      </div>
    </SectionCard>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
