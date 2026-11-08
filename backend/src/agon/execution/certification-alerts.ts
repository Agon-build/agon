import type { AgonOperationsAlertSink } from "../operations-alerts.ts";

export type AgonCertificationAlert = {
  operator: string;
  listingReference: string;
  listingVersion: string;
  status: "warning" | "suspended" | "recovered";
  reasons: readonly string[];
  consecutiveFailures: number;
};

export async function alertAgonCertificationOperator(
  input: AgonCertificationAlert,
  repository: AgonOperationsAlertSink,
): Promise<void> {
  const suspended = input.status === "suspended";
  const recovered = input.status === "recovered";
  const fingerprint = `certification:${input.listingReference}@${input.listingVersion}`;
  if (recovered) {
    // A warning that clears on the next check only closes the warning; a fresh
    // notice each time filled the bell (2026-11-06). A suspension closes too and
    // announces its recovery once: left open, every later warning folded into it
    // and each pass posted another notice (2026-11-08).
    if (await repository.resolve(input.operator, fingerprint)) return;
    if (!(await repository.resolve(input.operator, fingerprint, { critical: true }))) return;
  }
  await repository.raise({
    operator: input.operator,
    fingerprint: recovered ? `${fingerprint}:recovered` : fingerprint,
    source: "certification",
    scopeReference: input.listingReference,
    severity: recovered ? "info" : suspended ? "critical" : "warning",
    resolved: recovered,
    title: recovered
      ? "Agon service recovered"
      : suspended ? "Agon service suspended after repeated checks" : "Agon service check needs attention",
    body: recovered
      ? `Version ${input.listingVersion} is healthy again after an automatic recheck.`
      : `Version ${input.listingVersion} failed ${input.consecutiveFailures} consecutive check(s): ${input.reasons.join(", ") || "service promise not met"}.`,
    href: `/market/${encodeURIComponent(input.listingReference)}`,
    context: {
      listingReference: input.listingReference,
      listingVersion: input.listingVersion,
      status: input.status,
      reasons: input.reasons.slice(0, 16),
      consecutiveFailures: input.consecutiveFailures,
      source: "agon-certification-lifecycle",
    },
  });
}
