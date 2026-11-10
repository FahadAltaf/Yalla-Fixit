import assert from "node:assert/strict";
import test from "node:test";

import { formatPhone, phoneHref, toE164Phone } from "@/lib/phone/format-phone";

test("a UAE mobile reads as the phone input groups it", () => {
  assert.equal(formatPhone("+971500000001"), "+971 50 000 0001");
  assert.equal(formatPhone("+971 50 588 5903"), "+971 50 588 5903");
});

test("old local UAE numbers are read as UAE numbers", () => {
  assert.equal(toE164Phone("050 588 5903"), "+971505885903");
  assert.equal(formatPhone("0505885903"), "+971 50 588 5903");
  assert.equal(toE164Phone("00971505885903"), "+971505885903");
});

test("other countries use their own grouping, from the input's data", () => {
  assert.equal(formatPhone("+1 (886) 377-7092"), "+1 (886) 377-7092");
  assert.equal(formatPhone("+18863777092"), "+1 (886) 377-7092");
  /* A country with no grouping keeps its digits together after the code. */
  assert.equal(formatPhone("+963932522703"), "+963 932522703");
});

test("UAE landlines and toll-free numbers keep their usual grouping", () => {
  assert.equal(formatPhone("+97143211234"), "+971 4 321 1234");
  assert.equal(formatPhone("+9718007373328"), "+971 800 7373328");
});

test("empty stays empty, and links drop the spacing", () => {
  assert.equal(formatPhone(""), "");
  assert.equal(formatPhone(null), "");
  assert.equal(phoneHref("+971 50 000 0001"), "tel:+971500000001");
});
