"use client";

import { useState } from "react";
import { CloudUpload, SquarePen, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";

import { EditClientDialog } from "./edit-client-dialog";
import { useAmcData } from "./use-amc-data";

/* Signed and after: the client should be an FSM customer by now (DEV-504). */
const SIGNED_STATUSES = new Set(["signed", "pending_initial_payment", "active", "on_hold"]);

/**
 * DEV-504 (26 Nov 2026): the client becomes an FSM customer when the
 * contract is signed. When signing could not do it (no email,
 * the email belongs to another client, FSM did not answer), it says why
 * above the contract's tabs, with Edit client to fill in what is missing
 * and Create in FSM to try again.
 */
export function FsmClientNotice({ contractId, status, canManage }: { contractId: string; status: string; canManage: boolean }) {
  const signed = SIGNED_STATUSES.has(status);
  const { data, reload } = useAmcData(() => (signed ? amcContractsService.fsmClient(contractId) : Promise.resolve(null)), `fsm-client:${contractId}:${signed}`);
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!signed || !data || !data.writesOn || data.inFsm || !data.clientId) return null;

  const create = () =>
    void confirm({
      title: "Create the client in Zoho FSM?",
      description: `${data.clientName ?? "The client"} is linked to the FSM contact with the same email if FSM has one, otherwise created there, and the contract's property is added as their address.`,
      confirmText: "Create in FSM",
    }).then(async (ok) => {
      if (!ok) return;
      setBusy(true);
      try {
        const result = await amcContractsService.createFsmClient(contractId);
        toast.success(result.state === "linked" ? "Linked to the client Zoho FSM already had." : "Client created in Zoho FSM.");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not put the client into Zoho FSM.");
        reload();
      } finally {
        setBusy(false);
      }
    });

  return (
    <>
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>{data.clientName ?? "The client"} is not in Zoho FSM yet</AlertTitle>
        <AlertDescription>
          <p>{data.lastProblem ?? "A client becomes an FSM customer when the contract is signed. It has not happened for this contract yet."}</p>
          {canManage ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <SquarePen className="size-4" />
                Edit client
              </Button>
              <SubmitButton size="sm" onClick={create} pending={busy} pendingLabel="Creating…" icon={<CloudUpload className="size-4" />}>
                Create in FSM
              </SubmitButton>
            </div>
          ) : null}
        </AlertDescription>
      </Alert>
      {dialog}
      <EditClientDialog open={editing} onOpenChange={setEditing} customerId={data.clientId} onSaved={reload} />
    </>
  );
}
