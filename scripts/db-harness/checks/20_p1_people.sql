-- 20261020110000_people_reporting_fields: technician, user and leave fields; holidays.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Existing rows take today's behaviour.
SELECT harness.expect(
  (SELECT bool_and(employment_status = 'active' AND NOT hidden_from_lists AND leaving_date IS NULL AND rest_weekdays IS NULL)
     FROM public.technician_reference),
  'existing technicians: active, visible, no leaving date');
SELECT harness.expect((SELECT bool_and(NOT hidden_from_lists) FROM public.user_profile), 'existing users visible');
SELECT harness.expect((SELECT bool_and(leave_category IS NULL) FROM public.leave_records), 'existing leave uncategorised');

-- The writes live main makes still work unchanged.
INSERT INTO public.technician_reference (fsm_resource_id, display_name, is_active, last_synced_at)
VALUES ('T3', 'Tech Three', true, now())
ON CONFLICT (fsm_resource_id) DO UPDATE SET display_name = excluded.display_name;
INSERT INTO public.leave_records (technician_fsm_id, leave_type, start_at, end_at)
VALUES ('T3', 'Sick', '2026-10-05 05:00+04', '2026-10-05 17:00+04');
SELECT harness.expect((SELECT count(*) = 3 FROM public.technician_reference), 'live sync upsert and leave insert unaffected');

-- Constraints.
SELECT harness.expect_error($q$UPDATE public.technician_reference SET employment_status = 'resigned' WHERE fsm_resource_id = 'T2'$q$,
  '23514', 'resigned without a leaving date refused');
UPDATE public.technician_reference SET employment_status = 'resigned', leaving_date = '2026-10-15' WHERE fsm_resource_id = 'T2';
SELECT harness.expect((SELECT leaving_date = '2026-10-15' FROM public.technician_reference WHERE fsm_resource_id = 'T2'),
  'resigned with a leaving date stored (TC15 setup)');
SELECT harness.expect_error($q$UPDATE public.technician_reference SET employment_status = 'left' WHERE fsm_resource_id = 'T1'$q$,
  '23514', 'unknown employment status refused');
SELECT harness.expect_error($q$UPDATE public.technician_reference SET rest_weekdays = '{0}' WHERE fsm_resource_id = 'T1'$q$,
  '23514', 'weekday 0 refused');
SELECT harness.expect_error($q$UPDATE public.technician_reference SET rest_weekdays = '{8}' WHERE fsm_resource_id = 'T1'$q$,
  '23514', 'weekday 8 refused');
UPDATE public.technician_reference SET rest_weekdays = '{5,6}' WHERE fsm_resource_id = 'T1';
SELECT harness.expect((SELECT rest_weekdays = '{5,6}' FROM public.technician_reference WHERE fsm_resource_id = 'T1'),
  'Friday and Saturday stored as rest days');
UPDATE public.technician_reference SET user_profile_id = '00000000-0000-0000-0000-000000000001' WHERE fsm_resource_id = 'T1';
SELECT harness.expect_error($q$UPDATE public.technician_reference SET user_profile_id = '00000000-0000-0000-0000-000000000001' WHERE fsm_resource_id = 'T3'$q$,
  '23505', 'one portal account links to one technician');
SELECT harness.expect_error($q$UPDATE public.leave_records SET leave_category = 'unpaid'$q$, '23514', 'unknown leave category refused');
UPDATE public.leave_records SET leave_category = 'annual' WHERE technician_fsm_id = 'T1';
SELECT harness.expect((SELECT leave_category = 'annual' FROM public.leave_records WHERE technician_fsm_id = 'T1'), 'leave category stored');

-- Deleting the portal account unlinks rather than deletes the technician.
INSERT INTO public.user_profile (id, email, role_id)
VALUES ('00000000-0000-0000-0000-000000000003', 'gone@test.local', '00000000-0000-0000-0000-0000000000a1');
UPDATE public.technician_reference SET user_profile_id = '00000000-0000-0000-0000-000000000003' WHERE fsm_resource_id = 'T3';
DELETE FROM public.user_profile WHERE id = '00000000-0000-0000-0000-000000000003';
SELECT harness.expect((SELECT user_profile_id IS NULL FROM public.technician_reference WHERE fsm_resource_id = 'T3'),
  'deleted account unlinks the technician');

-- Holidays.
INSERT INTO public.org_public_holidays (holiday_date, name) VALUES ('2026-12-02', 'National Day');
SELECT harness.expect_error($q$INSERT INTO public.org_public_holidays (holiday_date, name) VALUES ('2026-12-02', 'Again')$q$,
  '23505', 'one holiday per date');
SELECT harness.expect_error($q$INSERT INTO public.org_public_holidays (holiday_date, name) VALUES ('2026-12-03', '  ')$q$,
  '23514', 'blank holiday name refused');
SET ROLE anon;
SELECT harness.expect_error($q$SELECT 1 FROM public.org_public_holidays$q$, '42501', 'anon cannot read holidays');
RESET ROLE;
SET ROLE authenticated;
SELECT harness.expect_error($q$UPDATE public.technician_reference SET hidden_from_lists = true$q$, '42501', 'authenticated cannot write technicians');
RESET ROLE;
