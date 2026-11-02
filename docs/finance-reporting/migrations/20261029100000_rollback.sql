-- Rollback of 20261029100000_hr_disputes (never automatic; run by hand only if asked).
-- Disputes and their decisions are lost. Waivers that accepted disputes made stay, without the link.
-- hr.finalize_month goes back to the 20261023100000 version (no undecided-dispute check).

BEGIN;

DROP FUNCTION IF EXISTS hr.raise_dispute(jsonb, text, date, boolean, uuid, text);
DROP FUNCTION IF EXISTS hr.decide_dispute(uuid, text, text, text, uuid, text);

ALTER TABLE hr.waivers DROP COLUMN IF EXISTS dispute_id;

DROP TABLE IF EXISTS hr.dispute_decisions;
DROP TABLE IF EXISTS hr.disputes;

CREATE OR REPLACE FUNCTION hr.finalize_month(
  p_month text, p_cutoff date, p_rows jsonb, p_settings jsonb, p_actor uuid, p_actor_label text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hr, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF (now() AT TIME ZONE 'Asia/Dubai')::date <= p_cutoff THEN
    RAISE EXCEPTION 'finalize_month: disputes for % are open until %', p_month, p_cutoff USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.compliance_months WHERE month = p_month) THEN
    RAISE EXCEPTION 'finalize_month: % is already finalised', p_month USING ERRCODE = 'unique_violation';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'finalize_month: rows must be an array' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO hr.compliance_months (month, settings, finalized_by, finalized_by_label)
  VALUES (p_month, p_settings, p_actor, p_actor_label);

  INSERT INTO hr.compliance_statements (month, technician_fsm_id, technician_name, required, performed, missed, waived,
                                        compliance_percent, below_threshold, penalty_before_cap, penalty_payable)
  SELECT p_month, r->>'technician', r->>'name', (r->>'required')::int, (r->>'performed')::int, (r->>'missed')::int,
         (r->>'waived')::int, (r->>'compliance_percent')::numeric, (r->>'below_threshold')::boolean,
         (r->>'penalty_before_cap')::numeric, (r->>'penalty_payable')::numeric
  FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
