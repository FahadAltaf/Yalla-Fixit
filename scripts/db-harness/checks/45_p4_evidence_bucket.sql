-- 20261022110000_finance_evidence_bucket: the private bucket for exclusion evidence.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT harness.expect(
  (SELECT count(*) = 1 FROM storage.buckets WHERE id = 'finance-evidence'),
  'one evidence bucket after two passes');
SELECT harness.expect(
  (SELECT NOT public AND file_size_limit = 10485760 AND 'application/pdf' = ANY (allowed_mime_types)
   FROM storage.buckets WHERE id = 'finance-evidence'),
  'the evidence bucket is private, 10 MB, PDF allowed');
