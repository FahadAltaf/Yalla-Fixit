"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { todayInDubai } from "@/lib/amc/contracts";
import { amcFresh } from "@/lib/amc/http-cache";
import { visitsService, type TechnicianRecord } from "@/modules/amc-contracts/visits-service";

import { EditTechnicianDialog } from "./technicians-page";

/**
 * A technician's AMC profile (trades and levels, certificates, areas, tools,
 * access, vehicle), opened from Workforce -> People's row menu (11 Nov 2026):
 * the AMC Technicians page left the AMC menu, so this is where it is kept.
 * The dialog opens at once with a loading body and reads only this one
 * technician (not the whole roster); who may change it is the AMC rule
 * (AMC Visits, Edit), checked by the server again on save.
 */
export function AmcSkillsDialog({ fsmId, name, onClose }: { fsmId: string; name: string; onClose: () => void }) {
  const [technician, setTechnician] = useState<TechnicianRecord | null>(null);

  useEffect(() => {
    let stale = false;
    amcFresh(() => visitsService.technician(fsmId)).then(
      (r) => {
        if (stale) return;
        if (!r.migrated) {
          toast.error("AMC skills are not set up on this database yet.");
          return onClose();
        }
        if (!r.canEdit) {
          toast.error("You can't change AMC skills. It needs AMC Visits (Edit).");
          return onClose();
        }
        if (!r.technician) {
          toast.error(`${name} is not on the AMC technician roster yet. Refresh the roster from Zoho FSM first.`);
          return onClose();
        }
        setTechnician(r.technician);
      },
      (e) => {
        if (stale) return;
        toast.error(e instanceof Error ? e.message : "Could not open the AMC skills.");
        onClose();
      },
    );
    return () => {
      stale = true;
    };
  }, [fsmId, name, onClose]);

  return (
    <EditTechnicianDialog
      open
      onOpenChange={(open) => !open && onClose()}
      technician={technician}
      loading={!technician}
      today={todayInDubai()}
      onSaved={() => undefined}
    />
  );
}
