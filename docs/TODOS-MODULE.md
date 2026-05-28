# Todos Module

The Todos module runs at `/todos` and stores its data in local/production Supabase tables:

- `todos`
- `todo_assignees`
- `todo_comments`

## Email Setup

The module uses the existing Resend route at `/api/send-email`, keeping the current environment variable names:

```env
NEXT_PUBLIC_RESEND_API_KEY=re_xxxxx
NEXT_PUBLIC_EMAIL_FROM="Yalla Fixit <todos@yourdomain.com>"
CRON_SECRET=long-random-secret
```

In Resend, verify the sending domain, add the required DNS records, create an API key, and use an email address from that verified domain in `NEXT_PUBLIC_EMAIL_FROM`.

## Reminder Cron

Reminder/followup emails are sent by calling:

```text
POST /api/todos/reminders/run
```

Send either header:

```text
x-cron-secret: your-secret
```

or:

```text
Authorization: Bearer your-secret
```

For production, configure Vercel Cron or another scheduler to call the endpoint every few minutes.

## Local Testing

1. Run migrations:

   ```powershell
   npm run supabase:reset
   ```

2. Run the app:

   ```powershell
   npm run dev
   ```

3. Open `/todos`, create a todo, assign users, and test status changes by both dragging cards and changing the status dropdown.
