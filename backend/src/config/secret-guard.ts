const PUBLIC_DEFAULT_JWT_SECRET = "dev-insecure-secret-change-me";
const MIN_SECRET_LENGTH = 32;
const MIN_PEPPER_LENGTH = 16;

export type SecretGuardInput = {
  NODE_ENV?: string;
  JWT_SECRET: string;
  EMAIL_OTP_ENABLED: boolean;
  OTP_PEPPER?: string;
};

/**
 * Secrets that must be real before production serves traffic. A missing
 * JWT_SECRET falls back to a public string that would let anyone mint a
 * session, so production refuses to start instead.
 */
export function productionSecretProblems(env: SecretGuardInput): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  if (env.JWT_SECRET === PUBLIC_DEFAULT_JWT_SECRET || env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be a private random value of at least ${MIN_SECRET_LENGTH} characters in production.`);
  }
  if (env.EMAIL_OTP_ENABLED && (!env.OTP_PEPPER || env.OTP_PEPPER.length < MIN_PEPPER_LENGTH)) {
    problems.push(`OTP_PEPPER must be set to at least ${MIN_PEPPER_LENGTH} characters when email codes are enabled in production.`);
  }
  return problems;
}
