-- =====================================================================
-- AMC: a proposal approved but not yet sent can be revised into a new version
--
-- Revising a proposal the client has seen locks the active version with its
-- document and opens V(n+1) as a draft (amc_lock_proposal_version, from
-- 20261007140000). The business wants the same for a proposal that was
-- approved internally but not sent: V1 is kept, locked as "approved", and V2
-- opens as a draft that goes through approval again, so the Versions tab
-- shows both.
--
-- The only change is the status list the function accepts: 'approved' is
-- added. Everything else is the function as it was.
--
-- Live safety
--   * Replaces one function; no table, column, constraint or policy changes.
--   * Live main never calls this function (proposal versions are AMC-only).
--   * Idempotent: CREATE OR REPLACE with the same signature, grants re-stated.
--
-- Post-check:
--   SELECT pg_get_functiondef('public.amc_lock_proposal_version(uuid, integer, text, text, uuid, jsonb, text, text, text, integer, text)'::regprocedure)
--     LIKE '%''approved''%';   -- expect true
-- =====================================================================

CREATE OR REPLACE FUNCTION public.amc_lock_proposal_version(
  p_submission_id uuid,
  p_expected_version integer,
  p_reason text,
  p_summary text,
  p_actor uuid,
  p_snapshot jsonb,
  p_content_sha256 text,
  p_storage_path text,
  p_content_type text,
  p_byte_size integer,
  p_file_sha256 text
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.amc_submissions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.amc_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'amc_version: proposal not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF s.current_version <> p_expected_version THEN
    RAISE EXCEPTION 'amc_version: the proposal is already at version %', s.current_version USING ERRCODE = 'serialization_failure';
  END IF;
  /* 'approved': approved internally, not yet sent, revised into a new version. */
  IF s.status NOT IN ('approved', 'proposal_sent', 'proposal_rejected', 'proposal_approved') THEN
    RAISE EXCEPTION 'amc_version: a proposal that is % is edited in place', s.status USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.amc_submission_versions (
    submission_id, version_no, reason, summary, started_at, started_by, locked_by, status_at_lock,
    final_price, discount_percent, payment_plan, valid_until, snapshot,
    content_sha256, storage_path, content_type, byte_size, file_sha256
  ) VALUES (
    s.id, s.current_version, s.version_reason, s.version_summary,
    COALESCE(s.version_started_at, s.created_at), COALESCE(s.version_started_by, s.owner_id), p_actor, s.status,
    s.final_price, COALESCE(s.discount_percent, 0), s.payment_plan, s.valid_until, p_snapshot,
    p_content_sha256, p_storage_path, p_content_type, p_byte_size, p_file_sha256
  );

  UPDATE public.amc_submissions SET
    current_version = s.current_version + 1,
    status = 'draft',
    version_reason = p_reason,
    version_summary = p_summary,
    version_started_at = now(),
    version_started_by = p_actor,
    settings_snapshot = NULL,
    proposal_token_hash = NULL,
    proposal_token_hint = NULL,
    proposal_token_expires_at = NULL,
    proposal_sent_at = NULL,
    client_decision = NULL,
    client_decided_at = NULL,
    client_decided_by_name = NULL,
    client_rejected_reason = NULL,
    submitted_at = NULL,
    decided_at = NULL,
    sent_back_reason = NULL,
    valid_until = NULL,
    updated_at = now()
  WHERE id = s.id;

  RETURN s.current_version + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.amc_lock_proposal_version(uuid, integer, text, text, uuid, jsonb, text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_lock_proposal_version(uuid, integer, text, text, uuid, jsonb, text, text, text, integer, text) TO service_role;
