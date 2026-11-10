"use client";

import { useEffect, useState } from "react";
import { complianceService } from "@/modules/compliance";
import type { ComplianceRights } from "@/lib/server/compliance/access";

const NONE: ComplianceRights = {
  view: false, create: false, edit: false, archive: false, export: false, settings_view: false, settings_create: false, settings_edit: false, full_numbers: false,
};

/** The caller's compliance rights, so controls the API would refuse are not shown. */
export function useComplianceRights(): { rights: ComplianceRights; loaded: boolean } {
  const [rights, setRights] = useState<ComplianceRights>(NONE);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    complianceService
      .rights()
      .then((r) => alive && setRights(r))
      .catch(() => alive && setRights(NONE))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);
  return { rights, loaded };
}
