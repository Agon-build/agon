import { timingSafeEqual } from "node:crypto";

export function verifyTelegramSecret(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
