import { test } from "node:test";
import assert from "node:assert/strict";

import { lineRemaining, lineStatus, workOrderInvoicing } from "@/lib/finance/line-status";

const line = (amount: number, ready = false, invoicedAmount = 0) => ({ amount, ready, invoicedAmount });

test("a line moves from not ready to ready to partially invoiced to invoiced", () => {
  assert.equal(lineStatus(line(5000)), "not_ready");
  assert.equal(lineStatus(line(5000, true)), "ready");
  assert.equal(lineStatus(line(5000, true, 3000)), "partially_invoiced");
  assert.equal(lineRemaining(line(5000, true, 3000)), 2000);
  assert.equal(lineStatus(line(5000, true, 5000)), "invoiced");
  assert.equal(lineStatus(line(5000, true, 4999.995)), "invoiced", "a fraction of a cent is rounding");
});

test("a work order is invoiced only when every line is; any invoiced amount makes it partial", () => {
  assert.equal(workOrderInvoicing([line(100), line(200)]).status, "not_ready");
  assert.equal(workOrderInvoicing([line(100, true), line(200)]).status, "ready");
  const partial = workOrderInvoicing([line(5000, true, 3000), line(3000, true, 3000), line(2000)]);
  assert.equal(partial.status, "partially_invoiced");
  assert.deepEqual(
    { ready: partial.readyValue, invoiced: partial.invoicedValue, remaining: partial.remainingValue },
    { ready: 2000, invoiced: 6000, remaining: 4000 },
    "ready = what Finance can invoice now; remaining includes the line not yet ready",
  );
  assert.equal(workOrderInvoicing([line(5000, true, 5000), line(3000, true, 3000)]).status, "invoiced");
  assert.equal(workOrderInvoicing([]).status, "not_ready", "no lines read yet");
});

test("a work order's queue status: excluded and invoiced first, then the workflow, then what the lines say", async () => {
  const { queueStatus } = await import("@/lib/finance/line-status");
  assert.equal(queueStatus("excluded", "ready"), "excluded");
  assert.equal(queueStatus("in_progress", "invoiced"), "invoiced", "invoiced in full ends the work, whoever picked it up");
  assert.equal(queueStatus("on_hold", "partially_invoiced"), "on_hold");
  assert.equal(queueStatus("open", "partially_invoiced"), "partially_invoiced");
  assert.equal(queueStatus("open", "ready"), "pending", "ready lines nobody has picked up");
  assert.equal(queueStatus("open", "not_ready"), "not_ready");
});
