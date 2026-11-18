# Brief for the mobile app: Start visit and the job sheet for call outs and additional work

18 Nov 2026. The portal side is built on branch `amc-hardening`, and the API is ready for the phone. The phone app (yfi-mobile-app) still needs the changes below. Until it has them, today's call-out attend/record and work-complete screens keep working. One exception: they now wait for Start visit (see 1).

## 1. Start visit (portal, 17 Nov)

The office starts a call out or an additional work on the portal, as it already does for a planned visit. Until then, the crew can't do the work.

- `GET /api/amc-sync/visits/[id]` for a call out or additional work now returns:
  - `waiting_for_start: true` while it isn't started (`can_edit` is false then).
  - `visit.access_status`, and `visit.client_confirmation` (additional work only).
- The portal refuses these until the visit is started (409, "has not been started: start the visit first"):
  - `amc_callout_attend`
  - `amc_work_complete`
  - the job sheet messages below
- **Phone:** show "Waiting for the office to start this visit" when `waiting_for_start` is true, as for a planned visit.

## 2. The job sheet for call outs and additional work (portal, 18 Nov)

A call out and an additional work now use the planned visit's job sheet, with the same document (`jobSheetSchema`). The only difference is `lines`: there is exactly one line, the work itself, with `lineId` = the call out's or additional work's id.

- **Detail** (`GET /api/amc-sync/visits/[id]`, kind `call_out` / `additional_work`) now fills:
  - `sheet_ready`: true once migration 20261118100000 is applied. When false, keep the old screens.
  - `sheet`, `lines`, `checklist`, `services`, `assets` and `outcome_groups`, in the same shapes as a planned visit's.
  - `photos`: still the record's own work photos (`amc_work_photos`). Keep sending them with `amc_work_photo` and `visit_kind`.
- **Saving:** `amc_sheet` (update) and `amc_submit` (insert) take an optional `payload.visit_kind`:
  - `"call_out"` or `"additional_work"` routes to the new sheet; left out, it means a planned visit, as before.
  - The crew check uses the call out's or additional work's crew.
- **What the portal does with it:**
  - Call out:
    - saving a sheet with `arrivedAt` marks it attended;
    - submitting records it as resolved (or pending works);
    - the supervisor then returns it, or closes it, which sends the service report.
  - Additional work: submitting puts it in review; closing marks the work completed and sends the service report.
- **Submit rules** (the same as a planned visit):
  - arrival and completion times;
  - an outcome for the one line, with a reason group when not completed;
  - every pending work needs a reason;
  - the client's name when work was done.

## What the phone should do

1. For a call out or additional work with `sheet_ready`, open the same job sheet screens as a planned visit (summary, the popups, then review and submit). Send `visit_kind` with `amc_sheet` and `amc_submit`.
2. Keep the old call-out form and Mark completed only when `sheet_ready` is false.
3. A supervisor's Return comes back as `sheet.status = "returned"` with `sheet.reviewComment`, as for a planned visit. The version changes when the sheet's status changes.
