"use client";

import { useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";
import { toast } from "sonner";

import { SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABELS, COMMUNICATION_CHANNELS } from "@/lib/amc/client-profile";
import { clientProfileService, type CommunicationInput } from "@/modules/amc-contracts/client-profile-service";

import { formatDateTime } from "../contract-status";
import { useAmcData } from "../use-amc-data";
import { useDialog } from "./use-dialog";

const DIRECTION_LABELS = { outbound: "To the client", inbound: "From the client", internal: "Internal note" } as const;

/**
 * The client's communication log (BRD 5.9): calls, WhatsApp, emails and
 * meetings, newest first. Anyone working on the client can add an entry;
 * entries are never edited, so the log stays a true record.
 */
export function CommunicationPanel({ customerId }: { customerId: string }) {
  const { data, error, loading, reload } = useAmcData(() => clientProfileService.communications(customerId), `comms|${customerId}`);
  const adding = useDialog();

  return (
    <SectionCard
      icon={<MessagesSquare />}
      title="Communication log"
      description="Every call, message and meeting with this client. Portal emails and messages are added here automatically in later phases."
      bodyClassName="border-t"
      action={
        data?.migrated !== false ? (
          <Button size="sm" variant="outline" onClick={() => adding.show(true)}>
            <Plus className="size-4" />
            Log a communication
          </Button>
        ) : null
      }
    >
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the log" message={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <ListSkeleton rows={4} />
      ) : data?.migrated === false ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">The communication log arrives with the Phase 2 database update (20261007120000).</p>
      ) : (data?.entries.length ?? 0) === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="size-5" />}
          title="Nothing logged yet"
          description="Log calls, WhatsApp conversations and meetings so the next person knows what was agreed."
          action={{ label: "Log a communication", onClick: () => adding.show(true) }}
        />
      ) : (
        <ul className="divide-y">
          {data!.entries.map((e) => (
            <li key={e.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                  {CHANNEL_LABELS[e.channel] ?? e.channel}
                </Badge>
                <span className="text-muted-foreground">{DIRECTION_LABELS[e.direction as keyof typeof DIRECTION_LABELS] ?? e.direction}</span>
                {e.source === "system" ? (
                  <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
                    Portal
                  </Badge>
                ) : null}
                <span className="text-muted-foreground ml-auto text-xs tabular-nums" title={formatDateTime(e.occurredAt)}>
                  {timeAgo(e.occurredAt)} · {e.loggedBy ?? "—"}
                </span>
              </div>
              {e.subject ? <div className="mt-1.5 text-sm font-medium">{e.subject}</div> : null}
              <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">{e.summary}</p>
            </li>
          ))}
        </ul>
      )}
      <LogDialog
        key={adding.key}
        open={adding.open}
        onOpenChange={adding.onOpenChange}
        onSave={async (input) => {
          await clientProfileService.logCommunication(customerId, input);
          toast.success("Logged");
          reload();
        }}
      />
    </SectionCard>
  );
}

function LogDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; onSave: (input: CommunicationInput) => Promise<void> }) {
  const [value, setValue] = useState<CommunicationInput>({ channel: "call", direction: "outbound", summary: "" });
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ ...value, subject: value.subject?.trim() || null, summary: value.summary.trim(), occurredAt: new Date(when).toISOString() });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the entry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log a communication</DialogTitle>
          <DialogDescription>Adds an entry to the client&apos;s log. Entries are kept as written; add a new one to correct or follow up.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Channel</Label>
            <Select value={value.channel} onValueChange={(channel) => setValue((v) => ({ ...v, channel }))}>
              <SelectTrigger aria-label="Channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMUNICATION_CHANNELS.filter((c) => c !== "portal").map((c) => (
                  <SelectItem key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Direction</Label>
            <Select value={value.direction} onValueChange={(direction) => setValue((v) => ({ ...v, direction: direction as CommunicationInput["direction"] }))}>
              <SelectTrigger aria-label="Direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DIRECTION_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="log-when">When</Label>
            <Input id="log-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="log-subject">Subject (optional)</Label>
            <Input id="log-subject" value={value.subject ?? ""} onChange={(e) => setValue((v) => ({ ...v, subject: e.target.value }))} maxLength={200} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="log-summary">What was said or agreed</Label>
            <Textarea id="log-summary" rows={4} value={value.summary} onChange={(e) => setValue((v) => ({ ...v, summary: e.target.value }))} maxLength={4000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…" disabled={!value.summary.trim()}>
            Log it
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
