import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createNotifier,
  type NotificationRequest,
  type NotificationRow,
  type NotificationStore,
  type StoredNotification,
} from "@/lib/server/notifications/notifier";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/* The database's unique (dedupe_key, channel, recipient_key) index, in memory. */
function memoryStore() {
  /* Rows move on from their inserted status (pending -> sent / failed). */
  type MemoryRow = Omit<StoredNotification, "status"> & {
    status: string;
    delivered_to?: string | null;
    sent_at?: string | null;
  };
  const rows: MemoryRow[] = [];
  const key = (r: Pick<NotificationRow, "dedupe_key" | "channel" | "recipient_user_id" | "recipient_email">) =>
    `${r.dedupe_key}|${r.channel}|${r.recipient_user_id ?? (r.recipient_email ?? "").toLowerCase()}`;
  const store: NotificationStore = {
    async claim(incoming) {
      const inserted: StoredNotification[] = [];
      for (const row of incoming) {
        if (rows.some((existing) => key(existing) === key(row))) continue;
        const stored: StoredNotification = { ...row, id: String(rows.length + 1) };
        rows.push({ ...stored });
        inserted.push(stored);
      }
      return inserted;
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
  };
  return { store, rows };
}

function mailer(fail = false) {
  const sent: { to: string[]; subject: string; html: string }[] = [];
  return {
    sent,
    send: async (input: { to: string[]; subject: string; html: string }) => {
      if (fail) throw new Error("Resend is down");
      sent.push(input);
    },
  };
}

const request = (over: Partial<NotificationRequest> = {}): NotificationRequest => ({
  event: "finance.digest",
  dedupeKey: "digest:2026-10-20",
  recipients: [
    { userId: ALICE, email: "alice@yallafixit.ae" },
    { userId: BOB, email: "bob@yallafixit.ae" },
  ],
  channels: ["in_app", "email"],
  title: "Ready to invoice",
  body: "3 items are waiting.",
  link: "/finance/queue",
  ...over,
});

test("blocked mode: in-app rows are suppressed and no email is sent", async () => {
  const { store, rows } = memoryStore();
  const mail = mailer();
  const notify = createNotifier({ store, sendEmail: mail.send, env: env({}) });
  const result = await notify(request());
  assert.equal(mail.sent.length, 0);
  assert.deepEqual(result.inApp, { delivered: 0, suppressed: 2, duplicate: 0 });
  assert.deepEqual(result.email, { sent: 0, failed: 0, suppressed: 2, duplicate: 0 });
  assert.ok(rows.every((r) => r.status === "suppressed"));
});

test("redirect mode: every email goes to the redirect address only, marked [DEV]", async () => {
  const { store, rows } = memoryStore();
  const mail = mailer();
  const notify = createNotifier({ store, sendEmail: mail.send, env: env({ NOTIFY_REDIRECT_TO: "dev@example.com" }) });
  await notify(request({ channels: ["email"] }));
  assert.equal(mail.sent.length, 2);
  for (const message of mail.sent) {
    assert.deepEqual(message.to, ["dev@example.com"]);
    assert.equal(message.subject, "[DEV] Ready to invoice");
  }
  assert.ok(rows.every((r) => r.status === "sent" && r.delivered_to === "dev@example.com"));
});

test("in-app outside live mode reaches only allowlisted users", async () => {
  const { store, rows } = memoryStore();
  const notify = createNotifier({ store, sendEmail: mailer().send, env: env({ NOTIFY_INAPP_ALLOWLIST: ALICE }) });
  const result = await notify(request({ channels: ["in_app"] }));
  assert.deepEqual(result.inApp, { delivered: 1, suppressed: 1, duplicate: 0 });
  assert.equal(rows.find((r) => r.recipient_user_id === ALICE)?.status, "delivered");
  assert.equal(rows.find((r) => r.recipient_user_id === BOB)?.status, "suppressed");
});

test("live mode delivers to the real recipients", async () => {
  const { store } = memoryStore();
  const mail = mailer();
  const notify = createNotifier({ store, sendEmail: mail.send, env: env({ FINANCE_NOTIFY_LIVE: "on" }) });
  const result = await notify(request());
  assert.equal(result.inApp.delivered, 2);
  assert.deepEqual(mail.sent.map((m) => m.to[0]).sort(), ["alice@yallafixit.ae", "bob@yallafixit.ae"]);
});

test("the same notification twice is delivered once", async () => {
  const { store, rows } = memoryStore();
  const mail = mailer();
  const notify = createNotifier({ store, sendEmail: mail.send, env: env({ FINANCE_NOTIFY_LIVE: "on" }) });
  await notify(request());
  const second = await notify(request());
  assert.equal(mail.sent.length, 2);
  assert.equal(rows.length, 4);
  assert.deepEqual(second.inApp, { delivered: 0, suppressed: 0, duplicate: 2 });
  assert.deepEqual(second.email, { sent: 0, failed: 0, suppressed: 0, duplicate: 2 });
});

test("a recipient listed twice, or with different letter case, gets one email", async () => {
  const { store } = memoryStore();
  const mail = mailer();
  const notify = createNotifier({ store, sendEmail: mail.send, env: env({ FINANCE_NOTIFY_LIVE: "on" }) });
  await notify(
    request({
      channels: ["email"],
      recipients: [{ email: "Alice@YallaFixit.ae" }, { email: "alice@yallafixit.ae" }],
    }),
  );
  assert.equal(mail.sent.length, 1);
});

test("a failed send is recorded as failed and not retried by a repeat call", async () => {
  const { store, rows } = memoryStore();
  const notify = createNotifier({ store, sendEmail: mailer(true).send, env: env({ FINANCE_NOTIFY_LIVE: "on" }) });
  const first = await notify(request({ channels: ["email"] }));
  assert.equal(first.email.failed, 2);
  assert.ok(rows.every((r) => r.status === "failed" && /Resend is down/.test(r.status_reason ?? "")));
  const second = await notify(request({ channels: ["email"] }));
  assert.equal(second.email.duplicate, 2);
});

test("a link that is not a portal path is refused before anything is written", async () => {
  const { store, rows } = memoryStore();
  const notify = createNotifier({ store, sendEmail: mailer().send, env: env({ FINANCE_NOTIFY_LIVE: "on" }) });
  for (const link of ["https://evil.example/x", "//evil.example", "javascript:alert(1)"]) {
    await assert.rejects(notify(request({ link })), /portal path/);
  }
  assert.equal(rows.length, 0);
});

test("the email body escapes the text it is given", async () => {
  const { store } = memoryStore();
  const mail = mailer();
  const notify = createNotifier({ store, sendEmail: mail.send, env: env({ FINANCE_NOTIFY_LIVE: "on" }) });
  await notify(request({ channels: ["email"], recipients: [{ email: "a@x.ae" }], body: "<script>x</script>" }));
  assert.ok(!mail.sent[0].html.includes("<script>"));
  assert.ok(mail.sent[0].html.includes("&lt;script&gt;"));
});
