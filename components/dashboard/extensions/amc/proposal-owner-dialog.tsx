"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { amcRequest } from "@/lib/amc/http-cache";

/*
  A proposal handed to someone else, or taken over (DEV-368, 20 Nov 2026):
  the team by role works on each other's proposals. The server checks the
  right and logs the change on the proposal's history.
*/

type Candidate = { id: string; name: string; email: string };
const url = "/api/amc-submissions/owner";

export async function takeOverProposal(id: string) {
  return amcRequest<{ ok: true; ownerName: string }>(url, { method: "POST", body: JSON.stringify({ id, takeOver: true }) });
}

export function ChangeOwnerDialog({
  open,
  onOpenChange,
  proposalId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  onChanged?: () => void;
}) {
  const [list, setList] = useState<{ ownerId: string; candidates: Candidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setError(null);
    setPicked("");
    amcRequest<{ ownerId: string; candidates: Candidate[] }>(`${url}?id=${encodeURIComponent(proposalId)}`).then(
      (data) => !stale && setList(data),
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not list the team."),
    );
    return () => {
      stale = true;
    };
  }, [open, proposalId]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await amcRequest<{ ok: true; ownerName: string }>(url, { method: "POST", body: JSON.stringify({ id: proposalId, ownerId: picked }) });
      toast.success(`${r.ownerName} owns this proposal now`);
      onOpenChange(false);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the owner.");
    } finally {
      setBusy(false);
    }
  };

  const others = (list?.candidates ?? []).filter((c) => c.id !== list?.ownerId);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change the owner</DialogTitle>
          <DialogDescription>
            The new owner works on the proposal from now on: edits, sends, revises it and gets its notices. The change is kept on its history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="proposal-owner">New owner</Label>
          {error ? (
            <p className="text-danger text-sm">{error}</p>
          ) : (
            <Select value={picked} onValueChange={setPicked} disabled={!list || busy}>
              <SelectTrigger id="proposal-owner" className="w-full">
                <SelectValue placeholder={list ? "Choose who takes it" : "Loading the team…"} />
              </SelectTrigger>
              <SelectContent>
                {others.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.email && c.email !== c.name ? <span className="text-muted-foreground"> · {c.email}</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-muted-foreground text-xs">Only people whose role can work on AMC proposals are listed.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} pendingLabel="Saving…" disabled={!picked} onClick={() => void save()}>
            Change owner
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
