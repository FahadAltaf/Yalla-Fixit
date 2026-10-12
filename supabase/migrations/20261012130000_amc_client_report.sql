-- =====================================================================
-- AMC reports: the client report's send record (BRD v0.3 5.15; DEV-410)
-- =====================================================================
-- NOT APPLIED. Row 27 in docs/production-migration-log.md, checks §19.
--
-- What it adds
--   * amc_send_log accepts 'client_report': the per-contract client
--     report emailed to the client (PDF attached) or prepared for
--     WhatsApp. The report itself is stored in amc_documents (level
--     'contract', category 'Client report'), which needs no change.
--   * Indexes the operational and commercial reports read by date.
--
-- The operational and commercial reports and the dashboard read the
-- existing tables; no report function or view is added.
--
-- Live safety
--   * Only AMC tables: amc_send_log's CHECK is replaced (the same list
--     plus one value), and three indexes on AMC-only tables. Nothing live
--     main reads is touched.
-- =====================================================================

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.amc_send_log'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%document%'
  LOOP
    EXECUTE format('ALTER TABLE public.amc_send_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.amc_send_log
  ADD CONSTRAINT amc_send_log_document_check
  CHECK (document IN ('proposal', 'contract', 'instalment_reminder', 'visit_confirmation', 'visit_reminder', 'service_report',
                      'call_out_acknowledgement', 'additional_work_quotation', 'client_report'));

-- The reports read by period.
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_reported ON public.amc_call_outs (reported_at);
CREATE INDEX IF NOT EXISTS idx_amc_payments_received ON public.amc_payments (received_on) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visits_closed ON public.amc_visits (closed_at) WHERE closed_at IS NOT NULL;
