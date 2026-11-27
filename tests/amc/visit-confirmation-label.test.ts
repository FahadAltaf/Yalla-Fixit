import { test } from "node:test";
import assert from "node:assert/strict";

import { confirmationLabel } from "@/lib/amc/visits";

/* 27 Nov 2026: a client who asked for another date on the link left the visit reading "Awaiting the client". */
test("a visit whose client last asked for another date says so; other states read as before", () => {
  const at = (minute: number) => `2026-11-27T06:${String(minute).padStart(2, "0")}:00Z`;
  assert.equal(confirmationLabel(null, []), "Not requested yet");
  assert.equal(confirmationLabel("pending", [{ outcome: "message_sent", attemptedAt: at(1) }]), "Awaiting the client");
  assert.equal(confirmationLabel("pending", [{ outcome: "message_sent", attemptedAt: at(1) }, { outcome: "reschedule_requested", attemptedAt: at(2) }]), "Client asked for another date");
  assert.equal(
    confirmationLabel("pending", [{ outcome: "reschedule_requested", attemptedAt: at(2) }, { outcome: "message_sent", attemptedAt: at(3) }]),
    "Client asked for another date",
    "a request sent since is not an answer",
  );
  assert.equal(confirmationLabel("confirmed", [{ outcome: "reschedule_requested", attemptedAt: at(2) }]), "Confirmed by the client");
  assert.equal(confirmationLabel("no_answer", []), "No answer after the attempts");
});
