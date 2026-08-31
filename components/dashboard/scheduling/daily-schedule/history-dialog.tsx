"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  scheduleService,
  type ScheduleEntry,
  type ScheduleVersion,
  type AuditResponse,
} from "@/modules/scheduling";
import StatusBadge from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

type Props = {
  date: string;
  onOpenChange: (open: boolean) => void;
};

function entryLabel(e: ScheduleEntry) {
  if (e.entry_type === "free_text") return e.title || "Untitled";
  const wo = e.fsm_work_order_name || e.fsm_work_order_id || "Work Order";
  const ap = e.fsm_appointment_name || (e.fsm_appointment_id ? "Appointment" : "Pending appointment");
  return `${wo} · ${ap}`;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  draft_revision: "Draft Revision",
  pending_approval: "Pending Approval",
  rejected: "Rejected",
  approved_syncing: "Approving",
  published: "Published",
  sync_failed: "Sync Failed",
  partially_synced: "Partially Synced",
};

// The operating date arrives as YYYY-MM-DD; show it the way the board does
// rather than as a raw ISO string in the title.
function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// A single merged timeline row.
type TimelineItem = { at: number; kind: string; who: string; detail?: string; tone?: "ok" | "bad" | "muted" };

export default function HistoryDialog({ date, onOpenChange }: Props) {
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  // Derive "loading" from whether the loaded data matches the selection, so we
  // never call setState synchronously inside the fetch effect.
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);
  const detailLoading = selectedVersionId !== null && loadedVersionId !== selectedVersionId;

  useEffect(() => {
    scheduleService
      .getHistory(date)
      .then((v) => {
        setVersions(v);
        if (v.length > 0) setSelectedVersionId(v[0].id);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load history"))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => {
    if (!selectedVersionId) return;
    let cancelled = false;
    Promise.all([
      scheduleService.getAudit(selectedVersionId),
      scheduleService.getVersionEntries(selectedVersionId),
    ])
      .then(([a, e]) => {
        if (cancelled) return;
        setAudit(a);
        setEntries(e);
        setLoadedVersionId(selectedVersionId);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load version"));
    return () => {
      cancelled = true;
    };
  }, [selectedVersionId]);

  // Approval decisions and FSM sync attempts are audit events now, so the
  // timeline reads from one stream instead of merging three stacked lists.
  const timeline = useMemo<TimelineItem[]>(() => {
    return (audit?.events ?? [])
      .map((e) => {
        const isSync = e.event_type.startsWith("sync_");
        const comment = (e.after_value as { comment?: string } | null)?.comment;

        let tone: TimelineItem["tone"] = "muted";
        if (e.status === "failed" || e.event_type === "version_rejected") tone = "bad";
        else if (e.status === "succeeded" || e.event_type.startsWith("version_")) tone = "ok";

        return {
          at: new Date(e.created_at).getTime(),
          kind: isSync
            ? `FSM ${e.event_type.replace(/^sync_/, "").replace(/_/g, " ")}${e.status ? ` — ${e.status}` : ""}`
            : e.event_type.replace(/_/g, " "),
          who: isSync
            ? "Zoho FSM"
            : (e.user_profile?.full_name ?? e.user_profile?.email ?? e.origin),
          detail: e.error_message ?? comment ?? undefined,
          tone,
        };
      })
      .sort((a, b) => b.at - a.at);
  }, [audit]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] w-[calc(100%-2rem)] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Schedule history — {formatDate(date)}</DialogTitle>
          <DialogDescription>
            Every version of this day, with the appointments it held and a timeline of what happened to it.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No versions exist for this date yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
            {/* Version list */}
            <div className="flex max-h-[68vh] flex-col gap-1.5 overflow-y-auto">
              {versions.map((v) => {
                const active = selectedVersionId === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVersionId(v.id)}
                    className={`flex flex-col items-start gap-1 rounded-md border p-2.5 text-left ${
                      active ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold">Version {v.version_number}</span>
                      {v.is_current && (
                        <span className="text-primary text-[10px] font-medium uppercase">Current</span>
                      )}
                    </div>
                    <StatusBadge status={STATUS_LABELS[v.status] ?? v.status} />
                    {v.submitted_at && (
                      <span className="text-muted-foreground text-[11px]">
                        Submitted {new Date(v.submitted_at).toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected version detail: appointments + timeline */}
            <div className="max-h-[68vh] overflow-y-auto pr-1">
              {detailLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="text-muted-foreground size-5 animate-spin" />
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <section>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                      Appointments in this version ({entries?.length ?? 0})
                    </h3>
                    {entries && entries.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        {entries.map((e) => {
                          const techs = (e.schedule_entry_assignments ?? [])
                            .map((a) => a.technician_reference?.display_name ?? a.technician_fsm_id)
                            .join(", ");
                          return (
                            <div key={e.id} className="rounded-md border p-2.5 text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{entryLabel(e)}</span>
                                <span className="text-muted-foreground text-xs tabular-nums">
                                  {new Date(e.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  {" – "}
                                  {new Date(e.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                              <div className="text-muted-foreground mt-0.5 text-xs">
                                {[e.shift === "night" ? "Night" : "Morning", e.address, techs || "No technicians"]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm">No appointments in this version.</p>
                    )}
                  </section>

                  <section>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                      Timeline
                    </h3>
                    {timeline.length > 0 ? (
                      <ol className="relative flex flex-col gap-0 border-l pl-4">
                        {timeline.map((t, i) => (
                          <li key={i} className="relative pb-3 last:pb-0">
                            <span
                              className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-[var(--background)] ${
                                t.tone === "bad" ? "bg-danger" : t.tone === "muted" ? "bg-ink/40" : "bg-success"
                              }`}
                            />
                            <div className="text-sm font-medium capitalize">{t.kind}</div>
                            <div className="text-muted-foreground text-xs">
                              {t.who} · {new Date(t.at).toLocaleString()}
                            </div>
                            {t.detail && (
                              <div className={`mt-0.5 text-xs ${t.tone === "bad" ? "text-destructive" : ""}`}>
                                {t.detail}
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-muted-foreground text-sm">No events recorded.</p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
