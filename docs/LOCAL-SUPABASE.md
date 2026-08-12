# Local Supabase Development

This repo is set up to run against a local Supabase stack so development work does not touch production data.

## Prerequisites

- Docker Desktop running.
- Node dependencies installed with `npm install`.
- Supabase CLI available through `npx` or the npm scripts in this repo.

If `npm run supabase:start` fails with a `dockerDesktopLinuxEngine` pipe error on Windows, open Docker Desktop and wait until it says the engine is running, then rerun the command.

## First Run

1. Start local Supabase:

   ```powershell
   npm run supabase:start
   ```

2. Print the local API keys:

   ```powershell
   npm run supabase:status
   ```

3. Create `.env.local` from `.env.local.example` and replace the anon/service-role keys with the values printed by Supabase:

   ```env
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=your-local-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key
   NEXT_PUBLIC_APP_URL=http://localhost:3032
   APP_URL=http://localhost:3032
   ```

4. Reset/apply migrations and seed data when needed:

   ```powershell
   npm run supabase:reset
   ```

5. Run the Next.js app:

   ```powershell
   npm run dev
   ```

6. Open:

   - App: `http://localhost:3032`
   - Supabase Studio: `http://127.0.0.1:54323`
   - Local email inbox: `http://127.0.0.1:54324`

## Working Rules

- Keep database structure in `supabase/migrations`.
- Keep local-only sample data in `supabase/seed.sql`.
- Do not put production secrets in `.env.local`.
- Do not use real customer data locally unless it has been intentionally sanitized.
- Test migrations locally with `npm run supabase:reset` before applying them to production.

## Promoting Approved Changes

- Code changes go through the normal Git branch and deployment workflow.
- Database changes should be added as new SQL migrations, reviewed, backed up against production, then applied intentionally to the live Supabase project.
- Edge Functions referenced by the app, such as `get-estimate`, `zoho-fsm-work-orders`, `zoho-fsm-appointments`, and `zoho-fsm-estimate-transitions`, are not currently present in this repo (deployed directly to the Supabase project) and are not versioned here. Test those with local stubs or a separate staging setup before relying on them.
- New Edge Functions for the Scheduling module, starting with `zoho-fsm-service-resources` (`supabase/functions/zoho-fsm-service-resources/`), *are* checked into this repo going forward. Deploy with `supabase functions deploy zoho-fsm-service-resources --project-ref <ref>`.
