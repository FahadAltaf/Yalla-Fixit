"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TimeSelect from "@/components/ui/time-select";
import { executeRESTBackend } from "@/lib/rest-server";
import { formatZonedDateTime, zonedTimeToUtc } from "@/lib/scheduling/org-time";

/*
  Leave for an employee who is not in FSM (Sami, 31 Oct 2026), kept on the
  Workforce profile only; the schedule board never sees it. For an employee
  linked to FSM since, the same card lists what was recorded before the
  link, read only: their leave now goes on the technician, where the board
  reads it.
*/
type EmployeeLeave = {
  id: string;
  leave_type: string;
  start_at: string;
  end_at: string;
  status: "active" | "cancelled";
  notes: string | null;
};

const api = "/api/workforce/leave";

export default function EmployeeLeaveCard({
  employeeId,
  linked,
  canAdd,
  canCancel,
}: {
  employeeId: string;
  /** Linked to an FSM technician: history only. */
  linked: boolean;
  canAdd: boolean;
  canCancel: boolean;
}) {
  const [records, setRecords] = useState<EmployeeLeave[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:30");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      executeRESTBackend<{ records: EmployeeLeave[]; leave_types: string[] }>(api, { params: { employeeId } })
        .then((res) => {
          setRecords(res.records);
          setTypes(res.leave_types);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load leave")),
    [employeeId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!leaveType || !startDate || !endDate) {
      toast.error("Leave type, start date, and end date are required");
      return;
    }
    setSaving(true);
    try {
      await executeRESTBackend(api, {
        method: "POST",
        body: {
          employeeId,
          leaveType,
          // Organisation time (Asia/Dubai), as Scheduling's leave form.
          startAt: zonedTimeToUtc(startDate, startTime).toISOString(),
          endAt: zonedTimeToUtc(endDate, endTime).toISOString(),
          notes: notes.trim() || null,
        },
      });
      toast.success("Leave added");
      setLeaveType("");
      setStartDate("");
      setEndDate("");
      setNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add leave");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await executeRESTBackend(api, { method: "PATCH", body: { id, status: "cancelled" } });
      toast.success("Leave cancelled");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel leave");
    }
  };

  // Linked: a history card, shown only once there is history to show.
  if (linked && (!records || records.length === 0)) return null;

  return (
    <SectionCard
      title={linked ? "Leave recorded before the FSM link" : "Leave"}
      description={
        linked
          ? "Kept for the record. It is not on the schedule board; new leave goes on the technician above."
          : "Not in FSM: this leave shows on this profile only, never on the schedule board."
      }
      bodyClassName="px-5 pb-5"
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-4">
        {!linked && canAdd && (
          <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Leave type
              <select
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                aria-label="Leave type"
              >
                <option value="">{types.length ? "— Leave type —" : "No leave types yet"}</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Notes
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              From
              <div className="flex gap-2">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Leave start date" />
                <TimeSelect value={startTime} onChange={setStartTime} aria-label="Leave start time" />
              </div>
            </div>
            <div className="flex flex-col gap-1 text-sm">
              To
              <div className="flex gap-2">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="Leave end date" />
                <TimeSelect value={endTime} onChange={setEndTime} aria-label="Leave end time" />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Button size="sm" onClick={() => void add()} disabled={saving}>
                <Plus className="size-4" /> Add leave
              </Button>
            </div>
          </div>
        )}
        {records === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : records.length === 0 ? (
          <p className="text-muted-foreground text-sm">No leave recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">To</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Notes</th>
                  {!linked && canCancel && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{r.leave_type}</td>
                    <td className="px-3 py-2">{formatZonedDateTime(r.start_at)}</td>
                    <td className="px-3 py-2">{formatZonedDateTime(r.end_at)}</td>
                    <td className="px-3 py-2">{r.status === "active" ? "Active" : "Cancelled"}</td>
                    <td className="text-muted-foreground px-3 py-2">{r.notes ?? ""}</td>
                    {!linked && canCancel && (
                      <td className="px-3 py-2 text-right">
                        {r.status === "active" && (
                          <Button size="sm" variant="ghost" onClick={() => void cancel(r.id)}>
                            Cancel
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
