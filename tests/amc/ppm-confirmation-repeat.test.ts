import assert from "node:assert/strict";
import test from "node:test";

import { confirmationUrgency } from "@/lib/amc/visits";
import { repeatPpmConfirmationReminder } from "@/lib/server/amc/visits";
import { fakeSupabase } from "./fake-supabase";

/* DEV-491 (20 Nov 2026): the PPM confirmation is asked again each day, coloured by urgency, until the client confirms. */
test("urgency follows the days left to the visit, and ends on confirmation", () => {
  assert.equal(confirmationUrgency("2026-11-28", "2026-11-22", "pending")?.level, "calm");
  assert.equal(confirmationUrgency("2026-11-25", "2026-11-22", "pending")?.level, "soon");
  assert.equal(confirmationUrgency("2026-11-23", "2026-11-22", "no_answer")?.label, "Visit tomorrow");
  assert.equal(confirmationUrgency("2026-11-23", "2026-11-22", "no_answer")?.level, "urgent");
  assert.equal(confirmationUrgency("2026-11-20", "2026-11-22", "pending")?.label, "Visit day passed 2 days ago");
  assert.equal(confirmationUrgency("2026-11-23", "2026-11-22", "confirmed"), null);
});

function seed(visit: Record<string, unknown>) {
  return fakeSupabase(
    {
      amc_visits: [visit],
      amc_todos: [{ id: "l1", dedupe_key: "ppm_confirmation:v1", todo_id: "t1", closed_at: null }],
      todos: [{ id: "t1", title: "Confirm PPM visit: AMC-C-1 visit 2", status: "todo", tags: [] }],
      amc_notifications: [],
    },
    { unique: { amc_notifications: [["dedupe_key", "channel", "recipient_key"]] }, generated: { amc_notifications: (r) => ({ recipient_key: r.recipient_user_id }) } },
  );
}
const contract = { contract_number: "AMC-C-1", customer_name: "Client", property_label: "Villa 4" };
const base = { id: "v1", contract_id: "c1", visit_no: 2, status: "scheduled", target_date: "2026-11-24", scheduled_start: null, client_confirmation: "pending", confirmation_due_notified_at: "2026-11-17T04:00:00Z" };

test("an unconfirmed visit is reminded once a day, with the urgency on the to-do", async () => {
  const w = seed(base);
  assert.equal(await repeatPpmConfirmationReminder(w.client as never, base, contract, "owner-1", "2026-11-22"), true);
  assert.equal(await repeatPpmConfirmationReminder(w.client as never, base, contract, "owner-1", "2026-11-22"), false, "a second run the same day sends nothing");
  assert.equal(w.table("amc_notifications").length, 1);
  assert.match(String(w.table("amc_notifications")[0].title), /^Soon: PPM visit still not confirmed/);
  const todo = w.table("todos")[0];
  assert.equal(todo.title, "Soon: Confirm PPM visit: AMC-C-1 visit 2");
  assert.deepEqual(todo.tags, ["PPM confirmation", "Visit in 2 days"]);
  assert.equal(await repeatPpmConfirmationReminder(w.client as never, base, contract, "owner-1", "2026-11-23"), true, "the next day, again");
  assert.match(String(w.table("amc_notifications")[1].title), /^Urgent:/);
});

test("no reminder once confirmed, before the first ask, or on the day of the first ask", async () => {
  const w = seed(base);
  assert.equal(await repeatPpmConfirmationReminder(w.client as never, { ...base, client_confirmation: "confirmed", status: "confirmed" }, contract, "owner-1", "2026-11-22"), false);
  assert.equal(await repeatPpmConfirmationReminder(w.client as never, { ...base, confirmation_due_notified_at: null }, contract, "owner-1", "2026-11-22"), false);
  assert.equal(await repeatPpmConfirmationReminder(w.client as never, { ...base, confirmation_due_notified_at: "2026-11-22T04:00:00Z" }, contract, "owner-1", "2026-11-22"), false);
  assert.equal(w.table("amc_notifications").length, 0);
});
