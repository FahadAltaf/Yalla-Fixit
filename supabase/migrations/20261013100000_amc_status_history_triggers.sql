-- =====================================================================
-- AMC status history for visits, job sheets, instalments and cheques
-- (BRD v0.3 6.9: "who changed each status and when"; DEV-424)
-- =====================================================================
-- NOT APPLIED. Row 29 in docs/production-migration-log.md, checks §21.
--
-- Why a trigger
--   Enquiries, proposals, contracts, call outs, additional works and
--   amendments write their status history from the server with the
--   person who acted. Visits, job sheets, instalments and cheques change
--   status in many places (the board, the schedule, the job sheet, the
--   payment sweep), so their history is written by the database on every
--   status change instead, and none can be missed. The actor is taken
--   from the row where it records one (closed_by, reviewed_by,
--   submitted_by, status_changed_by); otherwise it is the system.
--
--   The rows go to amc_audit_events as event 'status_changed' with
--   payload {from, to}, exactly as the server writes them, so the status
--   history screens read them the same way.
--
-- Live safety
--   AMC tables only (amc_visits, amc_visit_job_sheets, amc_instalments,
--   amc_cheques). Nothing live main reads is touched.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.amc_record_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  actor uuid;
  col text;
  i integer;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  /* The first actor column (trigger arguments after the entity type) that holds someone. */
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    col := TG_ARGV[i];
    IF row_json ? col AND row_json->>col IS NOT NULL THEN
      actor := (row_json->>col)::uuid;
      EXIT;
    END IF;
  END LOOP;
  INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type, actor_id, origin, justification, payload)
  VALUES (
    TG_ARGV[0],
    NEW.id,
    'status_changed',
    actor,
    CASE WHEN actor IS NULL THEN 'system' ELSE 'portal' END,
    NULLIF(trim(coalesce(row_json->>'status_reason', row_json->>'review_comment', '')), ''),
    jsonb_build_object('from', OLD.status, 'to', NEW.status, 'recordedBy', 'database')
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.amc_record_status_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS amc_visits_status_history ON public.amc_visits;
CREATE TRIGGER amc_visits_status_history
  AFTER UPDATE OF status ON public.amc_visits
  FOR EACH ROW EXECUTE FUNCTION public.amc_record_status_change('visit', 'closed_by');

DROP TRIGGER IF EXISTS amc_job_sheets_status_history ON public.amc_visit_job_sheets;
CREATE TRIGGER amc_job_sheets_status_history
  AFTER UPDATE OF status ON public.amc_visit_job_sheets
  FOR EACH ROW EXECUTE FUNCTION public.amc_record_status_change('job_sheet', 'reviewed_by', 'submitted_by');

DROP TRIGGER IF EXISTS amc_instalments_status_history ON public.amc_instalments;
CREATE TRIGGER amc_instalments_status_history
  AFTER UPDATE OF status ON public.amc_instalments
  FOR EACH ROW EXECUTE FUNCTION public.amc_record_status_change('instalment', 'status_changed_by');

DROP TRIGGER IF EXISTS amc_cheques_status_history ON public.amc_cheques;
CREATE TRIGGER amc_cheques_status_history
  AFTER UPDATE OF status ON public.amc_cheques
  FOR EACH ROW EXECUTE FUNCTION public.amc_record_status_change('cheque', 'recorded_by');
