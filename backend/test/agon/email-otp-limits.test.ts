import assert from "node:assert/strict";
import test from "node:test";

import { OTP_DAILY_PER_EMAIL, OTP_DAILY_PER_IP, generateOtpCode, otpSendRefusal } from "../../src/lib/emailOtpLimits.ts";

test("email codes are capped per email and per network address each day", () => {
  assert.equal(otpSendRefusal({ emailToday: 0, ipToday: 0 }), null);
  assert.equal(otpSendRefusal({ emailToday: OTP_DAILY_PER_EMAIL - 1, ipToday: OTP_DAILY_PER_IP - 1 }), null);
  assert.equal(otpSendRefusal({ emailToday: OTP_DAILY_PER_EMAIL, ipToday: 0 }), "otp_daily_limit");
  assert.equal(otpSendRefusal({ emailToday: 0, ipToday: OTP_DAILY_PER_IP }), "otp_daily_limit");
  assert.ok(OTP_DAILY_PER_EMAIL <= 10 && OTP_DAILY_PER_IP <= 30);
});

test("codes are six digits from a secure source", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const code = generateOtpCode();
    assert.match(code, /^\d{6}$/);
    seen.add(code);
  }
  assert.ok(seen.size > 190);
});
