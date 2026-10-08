"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Clock, FileUp, Link as LinkIcon, Mail, MessageCircle, Send, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import {
  ActionDialogContent,
  ErrorState,
  ListSkeleton,
  SectionSkeleton,
  SubmitButton,
} from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_ANSWERS, CLIENT_ANSWER_LABELS, TRIGGER_LABELS, type ApprovalTrigger, type ClientAnswer } from "@/lib/amc/approval-ladder";
import { clientProfileService } from "@/modules/amc-contracts/client-profile-service";

import type { AmcSubmission } from "./amc-types";

/* What GET /api/amc-submissions/sharing returns. */
interface SharingData {
  migrated: boolean;
  steps: Array<{
    id: string;
    versionNo: number;
    round: number;
    level: number;
    levelName: string;
    approverNames: string[];
    triggers: Array<{ key: ApprovalTrigger; level: number; detail: string }>;
    status: "waiting" | "pending" | "approved" | "rejected" | "returned" | "cancelled";
    openedAt: string | null;
    escalateAt: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    comment: string | null;
  }>;
  sendLog: Array<{
    id: string;
    versionNo: number;
    document: string;
    channel: string;
    recipients: Array<{ name: string; address: string }>;
    cc: string[];
    outcome: string;
    sentBy: string | null;
    sentAt: string;
  }>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

const STEP_TONE: Record<SharingData["steps"][number]["status"], string> = {
  waiting: "bg-mist text-ink-soft",
  pending: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  returned: "bg-danger/10 text-danger",
  cancelled: "bg-mist text-ink-soft",
};
const STEP_LABEL: Record<SharingData["steps"][number]["status"], string> = {
  waiting: "Waiting",
  pending: "Deciding now",
  approved: "Approved",
  rejected: "Rejected",
  returned: "Returned",
  cancelled: "Not needed",
};
const OUTCOME_LABEL: Record<string, string> = {
  sent: "Sent",
  prepared: "Prepared",
  link_created: "Link created",
  failed: "Failed",
  no_recipient: "No recipient",
};

/**
 * The proposal's approval ladder and its sends (BRD 5.5, 5.6): each level
 * with who decides it, what triggered it, who decided and why; each send
 * with its channel, recipients, version, user and time.
 */
export function ApprovalsAndSendsPanel({ submission }: { submission: AmcSubmission }) {
  const key = `${submission.id}:${submission.updated_at}`;
  const [state, setState] = useState<{ key: string; data: SharingData | null; error: string | null }>({ key: "", data: null, error: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let stale = false;
    request<SharingData>(`/api/amc-submissions/sharing?id=${submission.id}`).then(
      (data) => !stale && setState({ key, data, error: null }),
      (e) => !stale && setState({ key, data: null, error: e instanceof Error ? e.message : "Could not load." }),
    );
    return () => {
      stale = true;
    };
  }, [submission.id, key, reload]);

  const current = state.key === key ? state : { data: null, error: null };
  if (current.error) return <ErrorState title="Could not load the approvals and sends" message={current.error} onRetry={() => setReload((n) => n + 1)} />;
  if (!current.data) {
    return (
      <SectionSkeleton>
        <ListSkeleton rows={4} />
      </SectionSkeleton>
    );
  }
  const { steps, sendLog, migrated } = current.data;
  if (!migrated) {
    return (
      <SectionCard icon={<ShieldCheck />} title="Approvals and sends" bodyClassName="px-5 pb-5">
        <p className="text-muted-foreground text-sm">The approval ladder and the send log arrive with the AMC database update 20261007150000.</p>
      </SectionCard>
    );
  }
  /* Newest round first. */
  const rounds = [...new Set(steps.map((s) => `${s.versionNo}:${s.round}`))].reverse();

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        icon={<ShieldCheck />}
        title="Approval ladder"
        description="On sharing, the discount, the value, the payment plan and floor rates are checked; each crossed rule names the level that must approve, in sequence."
        bodyClassName="border-t"
      >
        {rounds.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">
            {["approved", "proposal_sent", "proposal_approved", "proposal_rejected", "contract_sent", "signed"].includes(submission.status)
              ? "Shared without approval: no rule was crossed."
              : "Checked when the proposal is submitted."}
          </p>
        ) : (
          rounds.map((roundKey) => {
            const group = steps.filter((s) => `${s.versionNo}:${s.round}` === roundKey);
            const first = group[0];
            return (
              <div key={roundKey} className="border-b px-5 py-4 last:border-b-0">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary" className="border-0 font-medium">
                    V{first.versionNo} · round {first.round}
                  </Badge>
                  <span className="text-muted-foreground">
                    {first.triggers.map((t) => `${TRIGGER_LABELS[t.key] ?? t.key}: ${t.detail} (level ${t.level})`).join(" · ")}
                  </span>
                </div>
                <ol className="space-y-2">
                  {group.map((s) => {
                    const Icon = s.status === "approved" ? CheckCircle2 : s.status === "rejected" || s.status === "returned" ? XCircle : s.status === "pending" ? Clock : Circle;
                    return (
                      <li key={s.id} className="flex flex-wrap items-start gap-2 text-sm">
                        <Icon className="text-muted-foreground mt-0.5 size-4" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            Level {s.level}: {s.levelName}{" "}
                            <span className="text-muted-foreground font-normal">({s.approverNames.length ? s.approverNames.join(", ") : "AMC approvers"})</span>
                          </div>
                          {s.decidedAt ? (
                            <div className="text-muted-foreground text-xs">
                              {STEP_LABEL[s.status]} by {s.decidedBy ?? "—"}, {when(s.decidedAt)}
                              {s.comment ? `: ${s.comment}` : ""}
                            </div>
                          ) : s.status === "pending" && s.escalateAt ? (
                            <div className="text-muted-foreground text-xs">Escalates {when(s.escalateAt)} if still open</div>
                          ) : null}
                        </div>
                        <Badge variant="secondary" className={`border-0 font-medium ${STEP_TONE[s.status]}`}>
                          {STEP_LABEL[s.status]}
                        </Badge>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })
        )}
      </SectionCard>

      <SectionCard icon={<Send />} title="Sends" description="Every share: channel, recipients, version, who and when (BRD 5.6)." bodyClassName="border-t">
        {sendLog.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">Not shared yet.</p>
        ) : (
          <ul className="divide-y">
            {sendLog.map((e) => {
              const Icon = e.channel === "email" ? Mail : e.channel === "whatsapp" ? MessageCircle : LinkIcon;
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
                  <Icon className="text-muted-foreground mt-0.5 size-4" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {e.document === "contract" ? "Contract" : `Proposal V${e.versionNo}`} by {e.channel === "whatsapp" ? "WhatsApp" : e.channel}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {e.recipients.length ? e.recipients.map((r) => (r.name ? `${r.name} <${r.address}>` : r.address)).join(", ") : "No recipient named"}
                      {e.cc.length ? ` · cc ${e.cc.join(", ")}` : ""}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <Badge variant="secondary" className={`border-0 font-medium ${e.outcome === "failed" ? "bg-danger/10 text-danger" : ""}`}>
                      {OUTCOME_LABEL[e.outcome] ?? e.outcome}
                    </Badge>
                    <div className="text-muted-foreground mt-1">
                      {when(e.sentAt)} · {e.sentBy ?? "—"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/** Whether an answer from outside the link can be recorded now: only while the proposal is with the client. */
export function canRecordClientAnswer(submission: AmcSubmission) {
  return submission.status === "proposal_sent";
}

/**
 * The client answered outside the link (BRD 5.6, DEV-371): record their
 * decision with the evidence, which goes to the proposal's documents.
 * Controlled, so the proposal page can open it from its "More" menu.
 */
export function RecordClientAnswerDialog({
  submission,
  open,
  onOpenChange,
  onRecorded,
}: {
  submission: AmcSubmission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const [answer, setAnswer] = useState<ClientAnswer | "">("");
  const [clientName, setClientName] = useState(submission.customer.customerName ?? "");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const record = async () => {
    if (!answer || !file) return;
    setBusy(true);
    try {
      const { document } = await clientProfileService.uploadDocument({
        file,
        level: "proposal",
        entityId: submission.id,
        category: "Client decision evidence",
        title: `${CLIENT_ANSWER_LABELS[answer]} by ${clientName.trim()}`,
      });
      await request("/api/amc-submissions/client-decision", {
        method: "POST",
        body: JSON.stringify({ id: submission.id, answer, clientName: clientName.trim(), note: note.trim() || null, evidenceDocumentId: document.id }),
      });
      toast.success(`Recorded: ${CLIENT_ANSWER_LABELS[answer]}. The client's link is closed.`);
      setBusy(false);
      onOpenChange(false);
      onRecorded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the answer.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record the client&apos;s answer</DialogTitle>
          <DialogDescription>
            For an answer given by email, phone or WhatsApp instead of the link; the evidence you attach is kept with the proposal&apos;s documents.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="answer-choice">Answer</Label>
            <Select value={answer} onValueChange={(v) => setAnswer(v as ClientAnswer)}>
              <SelectTrigger id="answer-choice" aria-label="Answer">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_ANSWERS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {CLIENT_ANSWER_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="answer-name">Who answered</Label>
            <Input id="answer-name" value={clientName} onChange={(e) => setClientName(e.target.value)} maxLength={200} />
          </div>
          {answer && answer !== "approved" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="answer-note">{answer === "revision_requested" ? "What they want changed" : "Why they declined"}</Label>
              <Textarea id="answer-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="answer-file">Evidence (PDF, image, Word)</Label>
            <Input id="answer-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void record()}
            disabled={!answer || !file || clientName.trim().length < 2 || (answer !== "approved" && !note.trim())}
            pending={busy}
            pendingLabel="Recording…"
            icon={<FileUp className="size-4" />}
          >
            Record
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
