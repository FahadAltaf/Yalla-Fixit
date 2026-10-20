-- Assertion helpers for the checks. Each check raises on its first failure,
-- which stops run.sh (ON_ERROR_STOP).
\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS harness;

-- Run a statement that must fail with the given SQLSTATE.
CREATE OR REPLACE FUNCTION harness.expect_error(stmt text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
    IF got <> expected_state THEN
      RAISE EXCEPTION 'FAIL %: expected SQLSTATE %, got % (%)', label, expected_state, got, SQLERRM;
    END IF;
    RAISE NOTICE 'ok   %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL %: statement succeeded, expected SQLSTATE %', label, expected_state;
END $$;

CREATE OR REPLACE FUNCTION harness.expect(condition boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'ok   %', label;
END $$;

GRANT USAGE ON SCHEMA harness TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA harness TO anon, authenticated, service_role;
