"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingArea, User } from "@/types/types";

/* The select's value for "the job's lead inspector". */
const LEAD = "__lead__";

/**
 * Several inspectors on one job (point 6).
 *
 * Each room can be given to an inspector other than the lead: civil and
 * MEP split between two people, or one inspector per floor. A room left on
 * "Lead inspector" goes to whoever leads the job. Each inspector's phone
 * shows the job with their own rooms open to them; the lead submits once
 * every room is done, and all the findings land in the one report.
 *
 * Each change saves on its own, so there is no second Save to forget.
 */
export function RoomInspectors({
  taskId,
  leadId,
  users,
  canEdit,
}: {
  taskId: string;
  leadId: string | null;
  users: User[];
  canEdit: boolean;
}) {
  const [rooms, setRooms] = useState<SnaggingArea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRooms(await snaggingService.listAreas(taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the rooms");
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const leadName =
    users.find((u) => u.id === leadId)?.full_name ??
    users.find((u) => u.id === leadId)?.email ??
    null;

  async function assign(room: SnaggingArea, value: string) {
    const inspectorId = value === LEAD || value === leadId ? null : value;
    if ((room.inspector_id ?? null) === inspectorId) return;
    setSavingId(room.id);
    try {
      await snaggingService.updateArea(taskId, { id: room.id, inspector_id: inspectorId });
      setRooms((current) =>
        (current ?? []).map((r) => (r.id === room.id ? { ...r, inspector_id: inspectorId } : r)),
      );
      toast.success(
        inspectorId
          ? `${room.name} given to ${users.find((u) => u.id === inspectorId)?.full_name ?? "the inspector"}`
          : `${room.name} back with the lead inspector`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reassign that room");
    } finally {
      setSavingId(null);
    }
  }

  const helpers = new Set((rooms ?? []).map((r) => r.inspector_id).filter(Boolean));

  return (
    <div className="mt-6 space-y-3 border-t pt-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="text-brand size-4" />
          Rooms by inspector
        </h3>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Give rooms to other inspectors to split the job, for example civil and MEP, or floor by
          floor. Findings from every inspector combine into one report; the lead submits it once
          every room is done.
          {helpers.size > 0
            ? ` ${helpers.size} other inspector${helpers.size === 1 ? "" : "s"} on this job.`
            : ""}
        </p>
      </div>

      {error ? (
        <p className="text-destructive text-sm">
          {error}{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : rooms === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading rooms…
        </p>
      ) : rooms.length === 0 ? (
        <p className="text-muted-foreground text-sm">This job has no rooms yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rooms.map((room) => (
            <li key={room.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <Building2 className="text-muted-foreground size-3.5" aria-hidden />
                {room.name}
              </span>
              {canEdit ? (
                <div className="flex items-center gap-2">
                  {savingId === room.id ? (
                    <Loader2 className="text-muted-foreground size-4 animate-spin" />
                  ) : null}
                  <Select
                    value={room.inspector_id ?? LEAD}
                    onValueChange={(value) => void assign(room, value)}
                    disabled={savingId === room.id}
                  >
                    <SelectTrigger className="w-60" aria-label={`Inspector for ${room.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={LEAD}>
                        Lead inspector{leadName ? ` (${leadName})` : ""}
                      </SelectItem>
                      {users
                        .filter((u) => u.id !== leadId)
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {(u.full_name || u.email) ?? u.id}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <span className="text-muted-foreground text-sm">
                  {room.inspector_id
                    ? ((users.find((u) => u.id === room.inspector_id)?.full_name ?? "Another inspector"))
                    : `Lead inspector${leadName ? ` (${leadName})` : ""}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
