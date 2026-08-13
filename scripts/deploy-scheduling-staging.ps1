# Applies the scheduling changes to the YFI Staging Supabase branch.
# Run from the Portal directory after `supabase login`.
#
#   supabase login
#   .\scripts\deploy-scheduling-staging.ps1

$ErrorActionPreference = "Stop"
$ProjectRef = "ulqitebapobdtsqvbucd"   # Yalla Fixit -> staging branch

Write-Host "Linking to $ProjectRef ..." -ForegroundColor Cyan
supabase link --project-ref $ProjectRef

# Additive and idempotent (ADD COLUMN IF NOT EXISTS), so it is safe to
# re-run and does not depend on remote migration history being in sync.
Write-Host "`nApplying migration: entry display names ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260724090000_add_entry_display_names.sql

Write-Host "`nApplying migration: sync error + retry ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260725090000_add_sync_error_and_retry.sql

Write-Host "`nApplying migration: appointment creation details ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260726090000_add_appointment_creation_details.sql

Write-Host "`nApplying migration: multiple appointments per work order ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260727090000_multi_appointment_per_workorder.sql

Write-Host "`nApplying migration: needs_sync (skip untouched appointments) ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260728090000_add_needs_sync.sql

Write-Host "`nApplying migration: technician attributes (role/service/shift/team leader) ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260729090000_technician_attributes.sql

Write-Host "`nApplying migration: approval-email recipient flag ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260730090000_add_approval_email_flag.sql

Write-Host "`nApplying migration: optional approval (chosen approver) ..." -ForegroundColor Cyan
supabase db query --linked -f supabase/migrations/20260731090000_optional_approval.sql

Write-Host "`nDeploying Edge Functions ..." -ForegroundColor Cyan
foreach ($fn in @(
  "zoho-fsm-service-resources",
  "zoho-fsm-appointment-create",
  "zoho-fsm-appointment-update",
  "zoho-fsm-reconcile",
  "zoho-fsm-work-order-lines",
  "zoho-fsm-work-order-search"
)) {
  Write-Host "  $fn" -ForegroundColor DarkGray
  supabase functions deploy $fn --project-ref $ProjectRef --no-verify-jwt
}

Write-Host "`nRefreshing the technician list (Active Users only) ..." -ForegroundColor Cyan
# The CLI has no `functions invoke`; call the deployed function over HTTP with
# the anon key from .env.local. (The pg_cron job also refreshes it every 30
# min, so this is just to see the result immediately.)
$envFile = Get-Content ".env.local"
$supaUrl = ($envFile | Where-Object { $_ -match '^SUPABASE_URL=' }) -replace '^SUPABASE_URL=', ''
$anonKey = ($envFile | Where-Object { $_ -match '^SUPABASE_ANON_KEY=' }) -replace '^SUPABASE_ANON_KEY=', ''
if ($supaUrl -and $anonKey) {
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$supaUrl/functions/v1/zoho-fsm-service-resources" `
      -Headers @{ Authorization = "Bearer $anonKey"; apikey = $anonKey } -ContentType "application/json" -Body "{}"
    Write-Host ("  refreshed: {0} technicians" -f $resp.resources.Count) -ForegroundColor DarkGray
  } catch {
    Write-Host "  (skipped - the cron job will refresh it within 30 min)" -ForegroundColor DarkGray
  }
}

Write-Host "`nVerifying the new columns exist ..." -ForegroundColor Cyan
supabase db query --linked "select column_name from information_schema.columns where table_name = 'schedule_entries' and column_name in ('fsm_work_order_name','fsm_appointment_name','last_sync_error','last_synced_at','fsm_appointment_type','fsm_schedule_type','fsm_service_line_item_ids')"

Write-Host "`nDone." -ForegroundColor Green
