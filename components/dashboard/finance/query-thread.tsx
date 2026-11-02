"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { timeAgo } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { QueryComment, QueryReplyAction, QuerySide, QueryThread, TagOption } from "@/lib/server/finance/queries";
import { cn } from "@/lib/utils";
import { financeService } from "@/modules/finance/finance-service";

/**
 * Queries as a comment thread (2 Nov), shared by the Queries page and the
 * work order page: a thread with its replies and the buttons for the side
 * the viewer acts as, and the dialog to raise one.
 *
 * Either side asks a question; the other side is told and replies; either
 * side replies again or closes the conversation (2 Nov: no resolved / not
 * resolved, no verification). "Not invoiceable" is a mark on the work order,
 * not a query; threads from before keep their old steps, as history.
 */

export type QueryPeople = { finance: TagOption[]; operations: TagOption[] };

export const SIDE_LABEL: Record<QuerySide, string> = { finance: "Finance", operations: "Operations" };
const other = (side: QuerySide): QuerySide => (side === "finance" ? "operations" : "finance");
const NO_TAG = "none";
/* Tagging one person is hidden for now (2 Nov): a query and its replies go to the whole other side. Set true to bring it back. */
const TAGGING = false;

const COMMENT_WORDS: Record<QueryComment["action"], string> = {
  raised: "asked",
  comment: "replied",
  not_resolved: "replied: not resolved",
  resolved: "resolved it",
  corrected: "corrected the completion",
  withdrawn: "withdrew the request to invoice",
  closed: "closed it",
};


/** The side someone acts as on a thread: the side it waits on if they are in it, else the side that raised it, else their only side. */
export function actingSideFor(thread: Pick<QueryThread, "waitingOn" | "raisedBySide">, sides: QuerySide[], preferred?: QuerySide | null): QuerySide | null {
  if (preferred && sides.includes(preferred)) return preferred;
  if (thread.waitingOn && sides.includes(thread.waitingOn)) return thread.waitingOn;
  if (sides.includes(thread.raisedBySide)) return thread.raisedBySide;
  return sides[0] ?? null;
}

export function QueryBadges({ thread }: { thread: QueryThread }) {
  return (
    <>
      <Badge
        variant="secondary"
        className={cn("border-0 font-medium", thread.kind === "not_invoiceable" ? "bg-destructive/10 text-destructive" : "bg-brand-50 text-brand")}
      >
        {thread.kind === "not_invoiceable" ? "Not invoiceable" : `${SIDE_LABEL[thread.raisedBySide]} asks`}
      </Badge>
      {thread.status === "open" ? (
        <Badge variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
          Waiting on {SIDE_LABEL[thread.waitingOn ?? other(thread.raisedBySide)]}
        </Badge>
      ) : (
        <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
          Closed
        </Badge>
      )}
    </>
  );
}

function TagPicker({
  people,
  value,
  onChange,
  side,
  className = "w-full sm:w-56",
}: {
  people: TagOption[];
  value: string;
  onChange: (v: string) => void;
  side: QuerySide;
  className?: string;
}) {
  if (!people.length) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={className} aria-label={`Tag someone in ${SIDE_LABEL[side]}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_TAG}>Tag no one ({SIDE_LABEL[side]} all see it)</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            Tag {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One thread: its comments, and the reply box for the side the viewer acts as. */
export function QueryThreadView({
  thread,
  sides,
  people,
  preferredSide,
  lineNames,
  showWorkOrder = false,
  onChanged,
}: {
  thread: QueryThread;
  sides: QuerySide[];
  people: QueryPeople;
  preferredSide?: QuerySide | null;
  /** Line names by id, when the work order is open. */
  lineNames?: Map<string, string>;
  showWorkOrder?: boolean;
  onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState(NO_TAG);
  const [busy, setBusy] = useState<QueryReplyAction | null>(null);
  const side = actingSideFor(thread, sides, preferredSide);
  const open = thread.status === "open";
  const trimmed = text.trim();

  const send = async (action: QueryReplyAction, done: string) => {
    if (!side) return;
    setBusy(action);
    try {
      await financeService.replyQuery(thread.id, { action, body: trimmed || null, taggedUserId: tag === NO_TAG ? null : tag, as: side });
      toast.success(done);
      setText("");
      setTag(NO_TAG);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The reply was not sent");
    } finally {
      setBusy(null);
    }
  };

  const lines = thread.lineIds.map((id) => lineNames?.get(id) ?? null).filter(Boolean);
  const woHref = `/finance/queue/${thread.workOrderId}`;

  return (
    <div className="flex flex-col gap-3">
      {showWorkOrder ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {thread.quotationNumber ? `Quotation ${thread.quotationNumber} · ` : ""}
            {thread.number ?? thread.workOrderId}
            {thread.clientName ? <span className="text-muted-foreground font-normal">· {thread.clientName}</span> : null}
            <QueryBadges thread={thread} />
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={woHref}>
              <ExternalLink className="size-4" />
              Open work order
            </Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <QueryBadges thread={thread} />
        </div>
      )}
      {thread.lineIds.length ? (
        <p className="text-muted-foreground text-xs">
          About {lines.length ? lines.join(", ") : `${thread.lineIds.length} ${thread.lineIds.length === 1 ? "line" : "lines"}`}
        </p>
      ) : null}

      <ol className="flex flex-col gap-2">
        {thread.comments.map((c) => (
          <li
            key={c.id}
            className={cn("rounded-lg border px-3 py-2 text-sm", c.side === "finance" ? "bg-brand-50/40" : "bg-muted/40", c.side !== thread.raisedBySide && "sm:ml-8")}
          >
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
              <span className="text-foreground font-medium">{c.author ?? "Someone"}</span>
              <span>({SIDE_LABEL[c.side]})</span>
              <span>{thread.kind === "not_invoiceable" && c.action === "not_resolved" ? "replied: it is invoiceable" : COMMENT_WORDS[c.action]}</span>
              {c.taggedLabel ? <span>· tagged {c.taggedLabel}</span> : null}
              <span>· {timeAgo(c.createdAt)}</span>
            </div>
            {c.body ? <p className="mt-1 whitespace-pre-wrap">{c.body}</p> : null}
          </li>
        ))}
        {thread.comments.length === 0 ? <li className="text-sm">{thread.subject}</li> : null}
      </ol>

      {open && side ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <Textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply" aria-label="Reply" />
          <div className="flex flex-wrap items-center gap-2">
            {TAGGING ? <TagPicker people={people[other(side)]} value={tag} onChange={setTag} side={other(side)} /> : null}
            <div className="ml-auto flex flex-wrap gap-2">
              <SubmitButton size="sm" variant="outline" pending={busy === "closed"} disabled={busy !== null} onClick={() => void send("closed", "Query closed")}>
                <CheckCircle2 className="size-4" />
                Close
              </SubmitButton>
              <SubmitButton size="sm" pending={busy === "comment"} disabled={!trimmed || busy !== null} onClick={() => void send("comment", "Reply sent")}>
                <MessageSquare className="size-4" />
                Reply
              </SubmitButton>
            </div>
          </div>
        </div>
      ) : !open ? (
        <p className="text-muted-foreground text-xs">
          Closed by {thread.resolvedBy ?? "someone"}
          {thread.resolvedAt ? `, ${timeAgo(thread.resolvedAt)}` : ""}.
        </p>
      ) : null}
    </div>
  );
}

/** Raise a query on a work order: a question to the other side. */
export function RaiseQueryDialog({
  open,
  onClose,
  workOrderId,
  workOrderNumber,
  side,
  people,
  lines,
  onRaised,
}: {
  open: boolean;
  onClose: () => void;
  workOrderId: string;
  workOrderNumber: string | null;
  side: QuerySide;
  people: QueryPeople;
  lines: Array<{ id: string; name: string | null }>;
  onRaised: () => void;
}) {
  const [body, setBody] = useState("");
  const [tag, setTag] = useState(NO_TAG);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const to = other(side);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await financeService.openQuery({ workOrderId, kind: "question", body: body.trim(), lineIds: [...picked], taggedUserId: tag === NO_TAG ? null : tag, as: side });
      toast.success(`Query sent to ${SIDE_LABEL[to]}`);
      setBody("");
      setPicked(new Set());
      setTag(NO_TAG);
      onRaised();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The query was not sent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a query{workOrderNumber ? ` on ${workOrderNumber}` : ""}</DialogTitle>
          <DialogDescription>
            {SIDE_LABEL[to]} {to === "operations" ? "are" : "is"} notified{TAGGING ? " (or only the person you tag)" : ""} and reply here. You are told when they do.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {lines.length > 1 ? (
            <div className="grid gap-1.5">
              <Label>Lines it is about (none ticked: the whole work order)</Label>
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-md border p-2">
                {lines.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={picked.has(l.id)}
                      onCheckedChange={(checked) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(l.id);
                          else next.delete(l.id);
                          return next;
                        })
                      }
                    />
                    {l.name ?? "A line"}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="query-body">Question</Label>
            <Textarea id="query-body" rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {TAGGING && people[to].length ? (
            <div className="grid gap-1.5">
              <Label>Tag someone in {SIDE_LABEL[to]} (optional)</Label>
              <TagPicker people={people[to]} value={tag} onChange={setTag} side={to} className="w-full" />
            </div>
          ) : null}
        </div>
        {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!body.trim()} onClick={() => void submit()}>
            Send query
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
