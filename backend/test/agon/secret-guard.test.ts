import assert from "node:assert/strict";
import test from "node:test";

import { productionSecretProblems } from "../../src/config/secret-guard.ts";

const strong = "k".repeat(48);

test("production refuses the public default JWT secret", () => {
  const problems = productionSecretProblems({ NODE_ENV: "production", JWT_SECRET: "dev-insecure-secret-change-me", EMAIL_OTP_ENABLED: false });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /JWT_SECRET/);
});

test("production refuses a short JWT secret", () => {
  assert.equal(productionSecretProblems({ NODE_ENV: "production", JWT_SECRET: "short-secret", EMAIL_OTP_ENABLED: false }).length, 1);
});

test("production needs an OTP pepper when email codes are on", () => {
  const problems = productionSecretProblems({ NODE_ENV: "production", JWT_SECRET: strong, EMAIL_OTP_ENABLED: true, OTP_PEPPER: undefined });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /OTP_PEPPER/);
});

test("a strong production configuration passes", () => {
  assert.deepEqual(productionSecretProblems({ NODE_ENV: "production", JWT_SECRET: strong, EMAIL_OTP_ENABLED: true, OTP_PEPPER: "p".repeat(32) }), []);
});

test("development keeps working with the default secret", () => {
  assert.deepEqual(productionSecretProblems({ NODE_ENV: "development", JWT_SECRET: "dev-insecure-secret-change-me", EMAIL_OTP_ENABLED: true }), []);
});
